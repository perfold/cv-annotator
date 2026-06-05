import numpy as np
from scipy.optimize import linear_sum_assignment

class KalmanFilter:
    def __init__(self):
        dt = 1.0 # time step btwn frames, we're looking frame by frame therefore dt=1
        n  = 4  # num of observed dims (centre x, centre y, w, h)
        self._F = np.eye(2 * n) # identity matrix of size 2*n
        for i in range(n):
            self._F[i, n + i] = dt # links velocity to position. cx += vcx * dt, cy += vcy*dt
        self._H  = np.eye(n, 2 * n) # get cx, cy, w, h, get's rid of vcx, vcy, vw, vh
        self._Q  = np.eye(2 * n) * 0.1 # process noise/model trust: how much model deviates from reality (0.1 suggests model is good)
        self._R  = np.eye(n) * 1.0 # measurement noise: how much we trust yolo's bbox coords (larger = noisier)

    def initiate(self, meas): # first detection of new target
        return np.r_[meas, np.zeros(4)], np.eye(8) * 10.0

    def predict(self, mean, cov): # extrapolate where next frame will be
        return self._F @ mean, self._F @ cov @ self._F.T + self._Q # _F@mean (pred next pos), _F@cov@F_.T (uncertainty goes up) + _Q (randomness)

    def update(self, mean, cov, meas): # correcting preds
        S   = self._H @ cov @ self._H.T + self._R # total uncertainty 
        K   = cov @ self._H.T @ np.linalg.inv(S) # kalman gain (0 to 1). high -> trust measurement, low->trust pred
        mean = mean + K @ (meas - self._H @ mean) # corrects preds, by moving it towards measurement, scaled by kalman gain
        cov  = (np.eye(len(mean)) - K @ self._H) @ cov # shrink covariance: uncertainty decreases after seeing new measurement
        return mean, cov


def iou_batch(a, b): # how much do bboxes overlap
    if len(a) == 0 or len(b) == 0: # if either are empty, nth to compare. return empty array
        return np.zeros((len(a), len(b)))
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1]) # (bottom right - top left x coords) * (bottom right - top left y coords). area
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    # left edge of intersection = max of the two left edges    
    ix1 = np.maximum(a[:, None, 0], b[None, :, 0])
    # top edge of intersection = max of the two top edges
    iy1 = np.maximum(a[:, None, 1], b[None, :, 1])
    # right edge of intersection = min of the two right edges
    ix2 = np.minimum(a[:, None, 2], b[None, :, 2])
    # bottom edge of intersection = min of the two bottom edges
    iy2 = np.minimum(a[:, None, 3], b[None, :, 3])

    inter = np.maximum(0, ix2 - ix1) * np.maximum(0, iy2 - iy1) # intersection area
    return inter / (area_a[:, None] + area_b[None, :] - inter + 1e-7) # intersection/union


def hungarian(cost, threshold):
    # cost: (N,M) matrix where cost[i,j] = how bad it is to pair track i with detection j
    # threshold: maximum cost to accept a match (1 - iou_threshold)
    # return confirmed pairs, unmatched track indexes, unmatched detection indexes

    if cost.size == 0: # no tracking or detections, everything unmatched
        return [], list(range(cost.shape[0])), list(range(cost.shape[1]))
    
    r, c = linear_sum_assignment(cost) # from scipy, gives 2 arrays, r (track index), c (det index)

    matched, ut, ud = [], [], [] # ut = unmatched tracks, ud= unmatched detections
    matched_r, matched_c = set(), set() # track/det indexes that got confirmed matches

    for ri, ci in zip(r, c): # check every assignment scipy gave
        if cost[ri, ci] <= threshold: # if cost below threshold, ok
            matched.append((ri, ci))
            matched_r.add(ri); matched_c.add(ci)
        else:
            ut.append(ri); ud.append(ci) # if cost too high, remove
    ut += [i for i in range(cost.shape[0]) if i not in matched_r and i not in ut] # add any tracks that scipy didnt assign a det to (happens when more tracks than dets)
    ud += [j for j in range(cost.shape[1]) if j not in matched_c and j not in ud] # add any dets that scipy didnt assign a track to (happens when more dets than tracks)
    return matched, ut, ud

def cosine_dist(a, b): # 1 - cosine_similarity. 0 = identical, 1 = orthogonal
    dot  = np.dot(a, b)
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    return 1.0 - dot / (norm + 1e-8)

class Track:
    _next_id = 0 # increments with each new track

    def __init__(self, det, kf):
        self.track_id = Track._next_id # assign track id to this target
        Track._next_id += 1 # increment trackid 
        self.class_name = det['class_name']

        # convert yolo bbox data to format for kalman filter
        cx = (det['xtl'] + det['xbr']) / 2
        cy = (det['ytl'] + det['ybr']) / 2
        w  = det['xbr'] - det['xtl']
        h  = det['ybr'] - det['ytl']
        self.mean, self.cov = kf.initiate(np.array([cx, cy, w, h], float)) # initiate kalman filter (velocity 0)
        self.time_since_update = 0 # num of frames since last matched
        self.state = 'tracked'
        emb = det.get('embedding', None)
        self.embedding_mean = np.array(emb, float) if emb is not None else None # running avg embedding for this track, None until embeddings computed

    def predict(self, kf):
        self.mean, self.cov = kf.predict(self.mean, self.cov) # pred the position in next frame
        self.time_since_update += 1

    def update(self, det, kf):

        # convert format for kf
        cx = (det['xtl'] + det['xbr']) / 2
        cy = (det['ytl'] + det['ybr']) / 2
        w  = det['xbr'] - det['xtl']
        h  = det['ybr'] - det['ytl']
        self.mean, self.cov = kf.update(self.mean, self.cov, np.array([cx, cy, w, h], float)) # correct kalman filter using actual det
        self.time_since_update = 0
        self.state = 'tracked'
        emb = det.get('embedding', None)
        alpha = 0.1 # how much new frame affects mean embedding
        if emb is not None:
            if self.embedding_mean is None:
                self.embedding_mean = np.array(emb, float)
            else:
                self.embedding_mean = (1-alpha) * self.embedding_mean + alpha * np.array(emb, float)

    def to_xyxy(self):
        cx, cy, w, h = self.mean[:4]
        return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] # give xyxy corner format for IoU calc

class ByteTracker:
    def __init__(self, track_thresh=0.5, match_thresh=0.5, max_lost=90):
        self.track_thresh = track_thresh # conf cutoff: det above this are 'strong', else 'weak'
        self.match_thresh = match_thresh # min IoU to accept a track-det pair as a real match
        self.max_lost = max_lost # num of frames before a lost track is dropped
        self.kf = KalmanFilter() # create kalman filter for all tracks
        self.tracked = [] # tracks matched to a det
        self.lost = [] # tracks that lost det but not dropped yet
        Track._next_id = 0 # reset IDs for each fresh run

    def update(self, dets: list) -> list: # dets=all yolo dets in this frame

        for t in self.tracked + self.lost: # move every track 1 frame forward using kf, lost tracks incl cause might re-track
            t.predict(self.kf)

        # split dets into strong (high conf) and weak (low conf)
        high = [d for d in dets if d['confidence'] >= self.track_thresh]
        low  = [d for d in dets if d['confidence'] <  self.track_thresh]

        all_tracks = self.tracked + self.lost

        # match all reliable dets against all tracks
        m1, ut1, ud1 = self._associate(all_tracks, high)
        for ti, di in m1:
            all_tracks[ti].update(high[di], self.kf) # update kf with actual det
            high[di]['track_id'] = all_tracks[ti].track_id

        # the tracks that didnt match yet
        remaining = [all_tracks[i] for i in ut1 if all_tracks[i].state == 'tracked']

        # match low conf dets
        m2, ut2, _ = self._associate(remaining, low)
        for ti, di in m2:
            remaining[ti].update(low[di], self.kf)
            low[di]['track_id'] = remaining[ti].track_id

        for i in ut2:
            remaining[i].state = 'lost' # the tracks that didnt match any dets

        # create new tracks for high conf dets that were not matched (might be new objects)
        new_tracks = []
        for di in ud1:
            t = Track(high[di], self.kf)
            high[di]['track_id'] = t.track_id
            new_tracks.append(t)

        # if low conf and unmatched, no trackid
        for d in low:
            d.setdefault('track_id', None)

        # update lists for next frame
        self.tracked = [t for t in all_tracks if t.state == 'tracked'] + new_tracks
        self.lost    = [t for t in all_tracks if t.state == 'lost'
                        and t.time_since_update <= self.max_lost]
        
        return dets

    def _associate(self, tracks, dets, emb_weight=0.3): # emb_weight affects how much visual similarity contributes vs iou (0 = iou only, 1 = visual only)

        if not tracks or not dets: # if no dets or tracks, return everything as unmatched
            return [], list(range(len(tracks))), list(range(len(dets)))
        
        tb = np.array([t.to_xyxy() for t in tracks]) # pred track positions
        db = np.array([[d['xtl'], d['ytl'], d['xbr'], d['ybr']] for d in dets]) # detected positions

        cost = 1 - iou_batch(tb, db) # cost matrix: lower cost = better overlap = better match

        track_embs = [t.embedding_mean for t in tracks]
        det_embs   = [d.get('embedding') for d in dets]
        for i, te in enumerate(track_embs):
            if te is None:
                continue
            for j, de in enumerate(det_embs):
                if de is None:
                    continue # leave this pair as pure iou cost
                vis = cosine_dist(te, de) # 0=same, 1=different
                cost[i, j] = (1 - emb_weight) * cost[i, j] + emb_weight * vis # weighted blend for this pair only

        return hungarian(cost, 1 - self.match_thresh) # use hungarian to assign pairs, rej if below IoU threshold