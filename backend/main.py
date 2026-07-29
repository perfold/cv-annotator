from fastapi import FastAPI, File, UploadFile, Body, Form
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import json
import subprocess
import sys
import asyncio
from pathlib import Path
from bytetrack import ByteTracker
import csv
import io
import numpy as np
from PIL import Image
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import AutoImageProcessor, AutoModel
from ultralytics import FastSAM

# paths
BASE_DIR     = Path(__file__).parent.parent
DATA_DIR     = BASE_DIR / "data"
INPUT_DIR    = DATA_DIR / "input"
OUTPUT_DIR   = DATA_DIR / "output"
MODELS_DIR   = BASE_DIR / "models"
YOLOV7_PATH  = MODELS_DIR / "yolov7"
YOLO_WEIGHTS = MODELS_DIR / "yolov7-tiny-visdrone-grouped.pt"

# check if repo and model are in the right dir
if not YOLOV7_PATH.exists():
    raise RuntimeError(f"YOLOv7 repo not found at {YOLOV7_PATH}.")
if not YOLO_WEIGHTS.exists():
    raise RuntimeError(f"YOLOv7-tiny weights not found at {YOLO_WEIGHTS}.")

sys.path.insert(0, str(YOLOV7_PATH))

from utils.datasets import LoadImages
from utils.general import non_max_suppression, scale_coords

# load yolov7-tiny
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
ckpt  = torch.load(str(YOLO_WEIGHTS), map_location=device, weights_only=False)
model = ckpt['model'].float().fuse().eval()
names  = model.module.names if hasattr(model, "module") else model.names
stride = int(model.stride.max())

# load FastSAM
SAM_WEIGHTS = MODELS_DIR / "FastSAM-x.pt" 
if not SAM_WEIGHTS.exists():
    raise RuntimeError(f"FastSAM weights not found at {SAM_WEIGHTS}. Pre-download FastSAM-x.pt into models/.")

sam = FastSAM(str(SAM_WEIGHTS))

EMBEDDINGS_CACHE_FILE = "embeddings.npz" # {bbox_id: [float, ...]} per video

# check if opencv-contrib-python is installed
if not hasattr(cv2, "TrackerCSRT_create"):
    raise RuntimeError(
        "cv2.TrackerCSRT_create not found. Install opencv-contrib-python"
    )

# load dinov3 convnext base + trained supcon mlp head for visual embeddings
DINOV3_LOCAL   = MODELS_DIR / "dinov3-convnext-base"
if not DINOV3_LOCAL.exists():
    raise RuntimeError(f"dinov3 snapshot not found at {DINOV3_LOCAL}. run `python setup_dino.py` while online.")

HEAD_WEIGHTS = MODELS_DIR / "dinov3_convnext_base_mlp_head_supcon.pt"
if not HEAD_WEIGHTS.exists():
    raise RuntimeError(f"supcon head weights not found at {HEAD_WEIGHTS}. copy from fe-test results/finetuned/.")

class MLPHead(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int = 512, output_dim: int = 256):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, output_dim),
        )

    def forward(self, x):
        return F.normalize(self.net(x), dim=-1)

# backbone
_dino_processor = AutoImageProcessor.from_pretrained(DINOV3_LOCAL) 
_dino_backbone  = AutoModel.from_pretrained(DINOV3_LOCAL).eval().to(device)
for _p in _dino_backbone.parameters():
    _p.requires_grad = False

# mlp head
_head_ckpt = torch.load(str(HEAD_WEIGHTS), map_location=device, weights_only=False)
_dino_head = MLPHead(
    input_dim=_head_ckpt["input_dim"],
    hidden_dim=_head_ckpt["hidden_dim"],
    output_dim=_head_ckpt["output_dim"],
).to(device)
_dino_head.load_state_dict(_head_ckpt["state_dict"])
_dino_head.eval()
for _p in _dino_head.parameters():
    _p.requires_grad = False

EMBED_DIM = _head_ckpt["output_dim"] # 256, old osnet cache is 512d

def _dino_preprocess(img_crop, image_size: int = 224):
    img = img_crop.convert("RGB")
    w, h = img.size
    side = max(w, h)
    padded = Image.new("RGB", (side, side), (0, 0, 0))
    padded.paste(img, ((side - w) // 2, (side - h) // 2))
    return padded.resize((image_size, image_size), Image.BILINEAR)

def _dino_embed_batch(pil_imgs):
    inputs = _dino_processor(images=pil_imgs, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        feats = _dino_backbone(**inputs).pooler_output 
        vecs = _dino_head(feats)              
    return vecs.cpu().numpy().astype(float)

def embed_chip(img_crop): # run a single target chip through dinov3, return normalised vector
    pil = _dino_preprocess(img_crop)
    vec = _dino_embed_batch([pil])[0]
    vec /= np.linalg.norm(vec) + 1e-8 
    return vec.tolist()

def embed_chips(img_crops, batch_size=64): # batched for embedding, much faster
    if not img_crops:
        return []
    out = []
    for i in range(0, len(img_crops), batch_size):
        pil_batch = [_dino_preprocess(c) for c in img_crops[i:i + batch_size]]
        vecs = _dino_embed_batch(pil_batch)
        vecs /= (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-8)
        out.extend(v.tolist() for v in vecs)
    return out

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


EXTRACTION_METADATA_FILE = "extraction_metadata.json" # stores jpeg_quality variable

# get frame rate of video using FFmpeg
def get_fps(video_path: str) -> float:
    result = subprocess.run( 
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "json",
            video_path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(result.stdout)
    raw = info["streams"][0]["r_frame_rate"]
    num, den = map(int, raw.split("/"))
    return num / den

# save extraction quality into a .json in output folder
def save_extraction_metadata(output_folder: str, quality: int, fps: float | None = None):
    path = Path(output_folder) / EXTRACTION_METADATA_FILE
    meta = get_extraction_metadata(output_folder)
    meta["quality"] = quality
    if fps is not None:
        meta["fps"] = fps
    with open(path, "w") as f:
        json.dump(meta, f)

# get extracted frames' quality
def get_extraction_metadata(output_folder: str) -> dict:
    path = Path(output_folder) / EXTRACTION_METADATA_FILE
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)
    
# check if video uploaded before and frames already extracted (prevents unnecessary work)
def frames_already_extracted(output_folder: str) -> bool:
    if not Path(output_folder).is_dir():
        return False
    return any(Path(output_folder).glob("*.jpg"))

# uses FFmpeg to extract video frames, returns num of frames
def extract_frames(video_path: str, output_folder: str, quality:int, fps: float | None = None) -> int:
    Path(output_folder).mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-i", video_path,
            "-q:v", str(quality),
            os.path.join(output_folder, "%07d.jpg"),
        ],
        check=True,
        capture_output=True,
    )
    save_extraction_metadata(output_folder, quality, fps)
    return len(list(Path(output_folder).glob("*.jpg")))

@app.post("/upload-video")

# function that takes in video upload, and breaks it up into individual frames
# if jpeg quality variable changed, re-extract
async def upload_video(file: UploadFile = File(...), quality: int = Form(default=31)):
    video_name = os.path.splitext(file.filename)[0]
    video_path = os.path.join(INPUT_DIR, file.filename)
    output_folder = os.path.join(OUTPUT_DIR, video_name)

    os.makedirs(INPUT_DIR, exist_ok=True)

    if not os.path.exists(video_path):
        contents = await file.read()
        with open(video_path, "wb") as f:
            f.write(contents)

    fps = get_fps(video_path)

    already_extracted = frames_already_extracted(output_folder)
    quality_changed = get_extraction_metadata(output_folder).get("quality") != quality

    if already_extracted and not quality_changed:
        frame_count = len(list(Path(output_folder).glob("*.jpg")))
        save_extraction_metadata(output_folder, quality, fps) # backfill fps for videos extracted before /videos existed
    else:
        if already_extracted: # wipe stale frames before re-extracting
            for f in Path(output_folder).glob("*.jpg"):
                f.unlink()
        frame_count = extract_frames(video_path, output_folder, quality, fps)

    return {
        "video_name": video_name,
        "frame_count": frame_count,
        "frame_rate": fps,
    }

# grab frames from frame folder path
@app.post("/load-frames-from-path")
async def load_frames_from_path(payload: dict = Body(...)):
    folder_path = Path(payload["folder_path"])
    
    if not folder_path.exists() or not folder_path.is_dir():
        return {"error": f"Folder not found: {folder_path}"}
    
    image_exts = {".jpg", ".jpeg", ".png"}
    frames = sorted([f for f in folder_path.iterdir() if f.suffix.lower() in image_exts])
    
    if not frames:
        return {"error": "No image files found in folder"}

    # symlink or copy frames into output dir so existing get_frame endpoint works
    folder_name = folder_path.name
    output_folder = OUTPUT_DIR / folder_name
    output_folder.mkdir(parents=True, exist_ok=True)

    for frame in frames:
        dest = output_folder / frame.name
        if not dest.exists():
            dest.symlink_to(frame.resolve())

    return {
        "video_name": folder_name,
        "frame_count": len(frames),
        "frame_rate": 30,
    }

# re-extract frame, if quality toggle is changed
@app.post("/reextract/{video_name}")
async def reextract_frames(video_name: str, payload: dict = Body(...)):
    quality = payload["quality"]
    output_folder = os.path.join(OUTPUT_DIR, video_name)

    # find the source video without needing to store the filename
    matches = list(Path(INPUT_DIR).glob(f"{video_name}.*"))
    video_path = str(matches[0])

    for f in Path(output_folder).glob("*.jpg"):
        f.unlink()

    frame_count = extract_frames(video_path, output_folder, quality)
    return {"frame_count": frame_count}

# function to get frame
@app.get("/frame/{video_name}/{frame_idx}")
def get_frame(video_name: str, frame_idx: int):
    folder = OUTPUT_DIR / video_name
    frames = sorted(folder.glob("*.jpg"))
    if frame_idx >= len(frames):
        return {"error": "Frame index out of range"}
    return FileResponse(frames[frame_idx])


# function to save annotations
@app.post("/save/{video_name}")
async def save_annotations(video_name: str, payload: dict = Body(...)):
    path     = Path(OUTPUT_DIR) / video_name / "annotations.json"
    tmp_path = path.with_suffix(".json.tmp") # write to temp first, then rename atomically
    with open(tmp_path, "w") as f: # prevents corrupt file if server crashes mid-write
        json.dump(payload, f, indent=2)
    tmp_path.replace(path)
    return {"status": "saved"}

# function to load annotations from prev save
@app.get("/load/{video_name}")
async def load_annotations(video_name: str):
    path = os.path.join(OUTPUT_DIR, video_name, "annotations.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except json.JSONDecodeError:
        return {"error": "annotations.json is corrupt. delete it and re-annotate"}

# run yolo on all frames
YOLO_CACHE_FILE = "yolo_raw_cache.json"   # stores all dets at conf=0.01

@app.post("/run-yolo/{video_name}")
async def run_yolo(video_name: str, payload: dict = Body(...)):
    conf_thres = payload.get("conf", 0.25)
    frames_dir = OUTPUT_DIR / video_name
    cache_path = frames_dir / YOLO_CACHE_FILE

    # if no cache yet, run yolo at conf=0.01
    if not cache_path.exists():
        dataset    = LoadImages(str(frames_dir), img_size=640, stride=stride)
        raw_cache  = {}   # frame_idx -> list of dets at conf=0.01

        # build filename -> sorted index mapping so frame_idx is consistent with get_frame
        all_frames = sorted(frames_dir.glob("*.jpg"))
        filename_to_idx = {f.name: i for i, f in enumerate(all_frames)}

        for path, img, im0, _ in dataset:
            frame_idx = filename_to_idx.get(Path(path).name, 0)
            img = torch.from_numpy(img).to(device).float() / 255.0
            if img.ndimension() == 3:
                img = img.unsqueeze(0)

            with torch.no_grad():
                pred = model(img)[0]

            # use a very low base threshold so we cache everything
            pred = non_max_suppression(pred, conf_thres=0.01, iou_thres=0.45)

            frame_dets = []
            for det in pred:
                if det is None or not len(det):
                    continue
                det[:, :4] = scale_coords(img.shape[2:], det[:, :4], im0.shape).round()
                for *xyxy, conf, cls in det:
                    frame_dets.append({
                        "class_name": names[int(cls)],
                        "xtl":        round(float(xyxy[0]), 2),
                        "ytl":        round(float(xyxy[1]), 2),
                        "xbr":        round(float(xyxy[2]), 2),
                        "ybr":        round(float(xyxy[3]), 2),
                        "confidence": round(float(conf), 4),
                    })

            if frame_dets:
                raw_cache[frame_idx] = frame_dets

        with open(cache_path, "w") as f:
            json.dump(raw_cache, f)
    else:
        with open(cache_path) as f:
            raw_cache = {int(k): v for k, v in json.load(f).items()}

    detections = {}
    for frame_idx in sorted(raw_cache.keys()):
        frame_dets = [d for d in raw_cache[frame_idx] if d["confidence"] >= conf_thres]
        if frame_dets:
            detections[frame_idx] = frame_dets
 
    detected_classes = list({d["class_name"] for dets in detections.values() for d in dets})
    return {"detections": detections, "classes": detected_classes}

# run bytetrack with re-id
@app.post("/track-reid/{video_name}")
async def track_reid(video_name: str, payload: dict = Body(...)):
    match_thresh = payload.get("match_thresh", 0.5)
    max_lost     = payload.get("max_lost", 90)

    ann_path = OUTPUT_DIR / video_name / "annotations.json"
    if not ann_path.exists():
        return {"error": "no annotations found. save the session first"}
    cache_path = OUTPUT_DIR / video_name / EMBEDDINGS_CACHE_FILE
    if not cache_path.exists():
        return {"error": "no embeddings found. compute embeddings first, then track"}

    emb_cache = load_embeddings_cache(cache_path) # {bbox_id: vec}, dim-guarded
    if not emb_cache:
        return {"error": "embedding cache is stale or empty. recompute embeddings first"}

    with open(ann_path) as f:
        data = json.load(f)
    bboxes_by_frame = data.get("bboxesByFrame", {})

    def track():
        tracker = ByteTracker(track_thresh=0.0, match_thresh=match_thresh, max_lost=max_lost)
        id_to_track = {}
        for frame_idx in sorted(int(k) for k in bboxes_by_frame.keys()):
            boxes = bboxes_by_frame[str(frame_idx)]
            dets = []
            for b in boxes:
                bid = b.get("id")
                if not bid:
                    continue
                dets.append({
                    "class_name": b.get("className", "object"),
                    "xtl": b.get("x", 0),
                    "ytl": b.get("y", 0),
                    "xbr": b.get("x", 0) + b.get("width", 0),
                    "ybr": b.get("y", 0) + b.get("height", 0),
                    "confidence": 1.0, 
                    "bbox_id": bid, 
                    "embedding": emb_cache.get(str(bid)), 
                })
            if not dets:
                continue
            tracked = tracker.update(dets)
            for d in tracked:
                tid = d.get("track_id")
                if d.get("bbox_id") is not None and tid is not None:
                    id_to_track[d["bbox_id"]] = tid
        return id_to_track

    loop = asyncio.get_event_loop()
    id_to_track = await loop.run_in_executor(None, track)
    return {"track_ids": id_to_track, "tracked_count": len(id_to_track)}

# propagate a single manually-drawn box forward with a csrt tracker.
@app.post("/propagate/{video_name}")
async def propagate_box(video_name: str, payload: dict = Body(...)):
    frames_dir = OUTPUT_DIR / video_name
    frame_files = sorted(frames_dir.glob("*.jpg"))
    n_frames = len(frame_files)

    # seed box in ORIGINAL pixel space 
    start_frame = int(payload["start_frame"])
    box = payload["box"] # {x, y, width, height} in original-resolution pixels
    x, y, w, h = float(box["x"]), float(box["y"]), float(box["width"]), float(box["height"])

    # stopping controls
    # disappearance of object is detected by the guards below (geometry + appearance re-check).
    emb_check_every = int(payload.get("emb_check_every", 5)) # run appearance re-check every n frames
    emb_dist_thresh = float(payload.get("emb_dist_thresh", 0.40))  # cosine dist past which object is "gone"
    edge_min_visible = float(payload.get("edge_min_visible", 0.5)) # stop once less than this fraction of the box is still inside the frame (0.5 means stop when half has exited)

    if start_frame < 0 or start_frame >= n_frames:
        return {"error": "start_frame out of range"}
    if w <= 1 or h <= 1:
        return {"error": "seed box too small"}

    def run_propagation():
        seed_img = cv2.imread(str(frame_files[start_frame])) # seed csrt on the start frame in original resolution
        if seed_img is None:
            return {}, "could not read start frame"
        img_h, img_w = seed_img.shape[:2] # frame dims, for the edge visibility check

        tracker = cv2.TrackerCSRT_create()
        tracker.init(seed_img, (int(x), int(y), int(w), int(h)))

        seed_crop = Image.fromarray(cv2.cvtColor(seed_img, cv2.COLOR_BGR2RGB)).crop( # grab chip 
            (int(x), int(y), int(x + w), int(y + h))
        )
        seed_emb = np.array(embed_chip(seed_crop), dtype=float) # cache appearance for re-check later on

        prev_box = (x, y, w, h)
        seed_area = w * h
        results = {} # frame_idx -> {x, y, width, height} in original space
        stop_reason = "end" # default if we reach the end of the video without a disappearance

        frame_idx = start_frame + 1
        steps_taken = 0
        # run until we run out of frames 
        while frame_idx < n_frames:

            img = cv2.imread(str(frame_files[frame_idx]))
            if img is None:
                stop_reason = "frame_read_failed"
                break

            ok, bbox = tracker.update(img)

            if not ok:
                stop_reason = "tracker_lost"
                break

            bx, by, bw, bh = bbox

            area = bw * bh # check area of box
            if area > seed_area * 6 or area < seed_area * 0.15: # if the area changes a LOT, probably an error
                stop_reason = "area_jump"
                break

            # check position of box
            cx_prev = prev_box[0] + prev_box[2] / 2
            cy_prev = prev_box[1] + prev_box[3] / 2
            cx_now, cy_now = bx + bw / 2, by + bh / 2
            jump = ((cx_now - cx_prev) ** 2 + (cy_now - cy_prev) ** 2) ** 0.5
            if jump > max(bw, bh) * 2: # if box move more than expected in 1 frame
                stop_reason = "position_jump"
                break

            # check how much of the box is still inside the frame
            ix1, iy1 = max(0, bx), max(0, by)
            ix2, iy2 = min(img_w, bx + bw), min(img_h, by + bh)
            inside_w, inside_h = max(0, ix2 - ix1), max(0, iy2 - iy1)
            visible_frac = (inside_w * inside_h) / (bw * bh + 1e-7)
            if visible_frac < edge_min_visible: # if object mostly gone (<50% visible)
                stop_reason = "frame_edge" # object left/leaving the frame 
                break

            # every (emb_check_every) frames, check if its still the same object
            if steps_taken % emb_check_every == 0:
                left, top = max(0, int(bx)), max(0, int(by))
                right, bot = int(bx + bw), int(by + bh)
                if right > left and bot > top:
                    crop = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).crop( # crop out chip
                        (left, top, right, bot)
                    )
                    cur_emb = np.array(embed_chip(crop), dtype=float) # embed chip

                    cos_dist = 1.0 - float(np.dot(seed_emb, cur_emb)) # get cos dist between the initial embedding and current embedding
                    if cos_dist > emb_dist_thresh: # if too diff, stop
                        stop_reason = "appearance_drift"
                        break

            # passed all guards: accept this frame's box
            results[frame_idx] = {"x": bx, "y": by, "width": bw, "height": bh}
            prev_box = (bx, by, bw, bh)
            frame_idx += 1
            steps_taken += 1

        return results, stop_reason

    loop = asyncio.get_event_loop()
    results, stop_reason = await loop.run_in_executor(None, run_propagation)
    return {"boxes": results, "stop_reason": stop_reason, "count": len(results)}

# function to return iou of two boxes in (x, y, w, h) original-pixel space
def _iou(a, b): 
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / (union + 1e-7)

# tighten every box in one frame into a polygon with fastsam
@app.post("/sam-polygon-tighten/{video_name}")
async def sam_polygon_tighten(video_name: str, payload: dict = Body(...)):
    frames_dir = OUTPUT_DIR / video_name
    frame_files = sorted(frames_dir.glob("*.jpg"))
    n_frames = len(frame_files)
 
    frame_idx = int(payload["frame_idx"])
    boxes = payload["boxes"] 
 
    if frame_idx < 0 or frame_idx >= n_frames:
        return {"error": "frame_idx out of range"}
    if not boxes:
        return {"boxes": [], "tightened": 0}
 
    def run_tighten():
        img = cv2.imread(str(frame_files[frame_idx]))
        if img is None:
            return [], "could not read frame"
        img_h, img_w = img.shape[:2]
 
        prompt_boxes, kept = [], []
        for bb in boxes:
            x, y = float(bb["x"]), float(bb["y"])
            w, h = float(bb["width"]), float(bb["height"])
            px1, py1 = max(0, x), max(0, y)
            px2, py2 = min(img_w, x + w), min(img_h, y + h)
            if px2 - px1 < 1 or py2 - py1 < 1:
                continue
            prompt_boxes.append([px1, py1, px2, py2]) 
            kept.append(bb)
 
        if not prompt_boxes:
            return [], "ok"
 
        # segment the whole frame once
        seg = sam(img, device=device, retina_masks=True, verbose=False)[0]

        out = []
        if seg.masks is None:
            print("[fastsam] seg.masks is None, no masks for whole frame")
            return [{**bb, "polygon": None} for bb in kept], "ok" # nothing found, hand every box back

        masks = seg.masks.data.cpu().numpy() # (M, H, W), every mask fastsam found in the frame
        # precompute masks and their areas once, reused across all boxes
        mbin = masks > 0.5
        mask_areas = mbin.reshape(mbin.shape[0], -1).sum(axis=1).astype(np.float64)

        for bb, pbox in zip(kept, prompt_boxes):
            bx1, by1, bx2, by2 = (int(round(v)) for v in pbox)
            box_area = float((bx2 - bx1) * (by2 - by1))

            # iou of the prompt box against every mask: intersection is the mask's pixels inside the box
            inter = mbin[:, by1:by2, bx1:bx2].reshape(mbin.shape[0], -1).sum(axis=1).astype(np.float64)
            union = box_area + mask_areas - inter
            ious = np.where(union > 0, inter / union, 0.0)

            best = int(np.argmax(ious))
            if ious[best] <= 0: # no mask overlaps this box at all
                out.append({**bb, "polygon": None}) # fastsam found nothing here, hand box back with no polygon
                continue

            mask_u8 = mbin[best].astype(np.uint8)
            cnts, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not cnts:
                out.append({**bb, "polygon": None}) # mask has no contour, so return no polygon
                continue

            c = max(cnts, key=cv2.contourArea) # largest contour = the object
            eps = 0.01 * cv2.arcLength(c, True)
            poly = cv2.approxPolyDP(c, eps, True).reshape(-1, 2) 

            px, py = poly[:, 0], poly[:, 1]
            out.append({
                "id": bb["id"],
                "x": float(px.min()), "y": float(py.min()),
                "width": float(px.max() - px.min()), "height": float(py.max() - py.min()),
                "polygon": poly.astype(float).tolist(), # [[x,y], ...] absolute frame pixels
            })

        return out, "ok"
 
    loop = asyncio.get_event_loop()
    result, status = await loop.run_in_executor(None, run_tighten)
    if status != "ok":
        return {"error": status}
    return {"boxes": result, "tightened": len(result)}

# tighten yolo bboxes using fastsam
@app.post("/sam-box-tighten/{video_name}")
async def sam_box_tighten(video_name: str, payload: dict = Body(...)):
    frames_dir = OUTPUT_DIR / video_name
    frame_files = sorted(frames_dir.glob("*.jpg"))
    n_frames = len(frame_files)

    frame_idx = int(payload["frame_idx"])
    boxes = payload["boxes"]

    if frame_idx < 0 or frame_idx >= n_frames:
        return {"error": "frame_idx out of range"}
    if not boxes:
        return {"boxes": [], "tightened": 0}

    def run_tighten():
        img = cv2.imread(str(frame_files[frame_idx]))
        if img is None:
            return [], "could not read frame"
        img_h, img_w = img.shape[:2]

        prompt_boxes, kept = [], []
        for bb in boxes:
            x, y = float(bb["x"]), float(bb["y"])
            w, h = float(bb["width"]), float(bb["height"])
            px1, py1 = max(0, x), max(0, y)
            px2, py2 = min(img_w, x + w), min(img_h, y + h)
            if px2 - px1 < 1 or py2 - py1 < 1:
                continue
            prompt_boxes.append([px1, py1, px2, py2])
            kept.append(bb)

        if not prompt_boxes:
            return [], "ok"

        # segment the whole frame once
        seg = sam(img, device=device, retina_masks=True, verbose=False)[0]

        out = []
        if seg.masks is None:
            print("[fastsam] seg.masks is None, no masks for whole frame")
            return [{**bb} for bb in kept], "ok" # nothing found, hand every box back untouched

        masks = seg.masks.data.cpu().numpy() # every mask fastsam found in the frame
        mbin = masks > 0.5
        mask_areas = mbin.reshape(mbin.shape[0], -1).sum(axis=1).astype(np.float64)

        for bb, pbox in zip(kept, prompt_boxes):
            ox1, oy1, ox2, oy2 = pbox 
            bx1, by1, bx2, by2 = (int(round(v)) for v in pbox)
            box_area = float((bx2 - bx1) * (by2 - by1))

            # iou of the prompt box against every mask
            inter = mbin[:, by1:by2, bx1:bx2].reshape(mbin.shape[0], -1).sum(axis=1).astype(np.float64)
            union = box_area + mask_areas - inter
            ious = np.where(union > 0, inter / union, 0.0)

            best = int(np.argmax(ious))
            if ious[best] <= 0: # no mask overlaps this box at all
                out.append({**bb}) # fastsam found nothing here, hand the box back untouched
                continue

            mask_u8 = mbin[best].astype(np.uint8)
            cnts, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not cnts:
                out.append({**bb}) # no contour, leave box as-is
                continue

            c = max(cnts, key=cv2.contourArea) # largest contour = the object
            mx, my, mw, mh = cv2.boundingRect(c) # axis-aligned bounds of the mask, in frame pixels

            # clamp the mask bounds to the original box so tightening only ever pulls the edges inwards, prevents a mask that spills past the yolo box (shadow, nearby object) enlarging it
            tx1 = max(ox1, float(mx))
            ty1 = max(oy1, float(my))
            tx2 = min(ox2, float(mx + mw))
            ty2 = min(oy2, float(my + mh))

            if tx2 - tx1 < 1 or ty2 - ty1 < 1:
                out.append({**bb}) 
                continue

            out.append({
                "id": bb["id"],
                "x": tx1, "y": ty1,
                "width": tx2 - tx1, "height": ty2 - ty1,
                "polygon": None, # pure box tighten, explicitly clear any stale polygon on this box
            })

        return out, "ok"

    loop = asyncio.get_event_loop()
    result, status = await loop.run_in_executor(None, run_tighten)
    if status != "ok":
        return {"error": status}
    return {"boxes": result, "tightened": len(result)}

# track FA forward with csrt, and tag every existing box it overlaps (if its the same class)
@app.post("/mark-fa-track/{video_name}")
async def mark_fa_track(video_name: str, payload: dict = Body(...)):
    frames_dir = OUTPUT_DIR / video_name
    frame_files = sorted(frames_dir.glob("*.jpg"))
    n_frames = len(frame_files)

    # seed box in ORIGINAL pixel space
    start_frame = int(payload["start_frame"])
    box = payload["box"]
    x, y, w, h = float(box["x"]), float(box["y"]), float(box["width"]), float(box["height"])

    # existing boxes per frame, original pixel space, for iou-matching the track.
    existing = payload.get("existing", {})

    # fa matching controls
    fa_class = payload.get("fa_class") # class of the seed fa
    match_class = bool(payload.get("match_class", True)) # true to only tag same-class boxes as the seed
    iou_thresh = float(payload.get("iou_thresh", 0.3)) # min overlap to count the track as hitting a box

    # stopping controls, same as propagate manually drawn box logic  (geometry + appearance re-check)
    emb_check_every = int(payload.get("emb_check_every", 5))
    emb_dist_thresh = float(payload.get("emb_dist_thresh", 0.40))
    edge_min_visible = float(payload.get("edge_min_visible", 0.5))

    if start_frame < 0 or start_frame >= n_frames:
        return {"error": "start_frame out of range"}
    if w <= 1 or h <= 1:
        return {"error": "seed box too small"}

    def run_fa_track():
        seed_img = cv2.imread(str(frame_files[start_frame])) # seed csrt on the start frame in original resolution
        if seed_img is None:
            return [], "could not read start frame"
        img_h, img_w = seed_img.shape[:2] # frame dims, for the edge visibility check

        tracker = cv2.TrackerCSRT_create()
        tracker.init(seed_img, (int(x), int(y), int(w), int(h)))

        seed_crop = Image.fromarray(cv2.cvtColor(seed_img, cv2.COLOR_BGR2RGB)).crop( # grab chip
            (int(x), int(y), int(x + w), int(y + h))
        )
        seed_emb = np.array(embed_chip(seed_crop), dtype=float) # cache appearance for re-check later on

        prev_box = (x, y, w, h)
        seed_area = w * h
        matched_ids = [] # ids of existing boxes the track hit, these get tagged fa
        stop_reason = "end" # default if we reach the end of the video without a disappearance

        frame_idx = start_frame + 1
        steps_taken = 0
        # run until we run out of frames
        while frame_idx < n_frames:

            img = cv2.imread(str(frame_files[frame_idx]))
            if img is None:
                stop_reason = "frame_read_failed"
                break

            ok, bbox = tracker.update(img)

            if not ok:
                stop_reason = "tracker_lost"
                break

            bx, by, bw, bh = bbox

            area = bw * bh # check area of box
            if area > seed_area * 6 or area < seed_area * 0.15: # if the area changes a LOT, probably an error
                stop_reason = "area_jump"
                break

            # check position of box
            cx_prev = prev_box[0] + prev_box[2] / 2
            cy_prev = prev_box[1] + prev_box[3] / 2
            cx_now, cy_now = bx + bw / 2, by + bh / 2
            jump = ((cx_now - cx_prev) ** 2 + (cy_now - cy_prev) ** 2) ** 0.5
            if jump > max(bw, bh) * 2: # if box move more than expected in 1 frame
                stop_reason = "position_jump"
                break

            # check how much of the box is still inside the frame
            ix1, iy1 = max(0, bx), max(0, by)
            ix2, iy2 = min(img_w, bx + bw), min(img_h, by + bh)
            inside_w, inside_h = max(0, ix2 - ix1), max(0, iy2 - iy1)
            visible_frac = (inside_w * inside_h) / (bw * bh + 1e-7)
            if visible_frac < edge_min_visible: # if object mostly gone (<50% visible)
                stop_reason = "frame_edge" # object left/leaving the frame
                break

            # every (emb_check_every) frames, check if its still the same object
            if steps_taken % emb_check_every == 0:
                left, top = max(0, int(bx)), max(0, int(by))
                right, bot = int(bx + bw), int(by + bh)
                if right > left and bot > top:
                    crop = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).crop( # crop out chip
                        (left, top, right, bot)
                    )
                    cur_emb = np.array(embed_chip(crop), dtype=float) # embed chip

                    cos_dist = 1.0 - float(np.dot(seed_emb, cur_emb)) # get cos dist between the initial embedding and current embedding
                    if cos_dist > emb_dist_thresh: # if too diff, stop
                        stop_reason = "appearance_drift"
                        break

            # if passed all guards, instead of adding a box, tag boxes as fa
            best_id, best_iou = None, iou_thresh 
            for c in existing.get(str(frame_idx), []):
                if match_class and fa_class is not None and c.get("className") != fa_class:
                    continue # skip boxes that aren't the same class as the seed fa
                cb = (float(c["x"]), float(c["y"]), float(c["width"]), float(c["height"]))
                iou = _iou((bx, by, bw, bh), cb)
                if iou > best_iou:
                    best_id, best_iou = c["id"], iou
            if best_id is not None:
                matched_ids.append(best_id)

            prev_box = (bx, by, bw, bh)
            frame_idx += 1
            steps_taken += 1

        return matched_ids, stop_reason

    loop = asyncio.get_event_loop()
    matched_ids, stop_reason = await loop.run_in_executor(None, run_fa_track)
    return {"matched_ids": matched_ids, "stop_reason": stop_reason, "count": len(matched_ids)}

# compute class label distribution for video
def compute_stats(video_name: str, bboxes_by_frame: dict) -> list[dict]:
    class_bbox_counts = {}
    class_frame_sets = {}

    for frame_idx, bboxes in bboxes_by_frame.items():
        for bbox in bboxes:
            cls = bbox.get("className", "unknown")
            class_bbox_counts[cls] = class_bbox_counts.get(cls, 0) + 1
            if cls not in class_frame_sets:
                class_frame_sets[cls] = set()
            class_frame_sets[cls].add(frame_idx)

    total_bboxes = sum(class_bbox_counts.values())
    total_annotated_frames = len(bboxes_by_frame)

    rows = []
    for cls in sorted(class_bbox_counts.keys()):
        bbox_count = class_bbox_counts[cls]
        frame_count = len(class_frame_sets[cls])
        rows.append({
            "video": video_name,
            "class": cls,
            "bbox_count": bbox_count,
            "pct_of_total": f"{bbox_count / total_bboxes * 100:.1f}%" if total_bboxes else "0.0%",
            "frame_count": frame_count,
            "pct_of_annotated_frames": f"{frame_count / total_annotated_frames * 100:.1f}%" if total_annotated_frames else "0.0%",
        })

    return rows

# list every uploaded video
@app.get("/videos")
def list_videos():
    videos = []
    if not OUTPUT_DIR.is_dir():
        return videos
    for video_dir in OUTPUT_DIR.iterdir():
        if not video_dir.is_dir():
            continue
        frame_count = len(list(video_dir.glob("*.jpg")))
        if frame_count == 0:
            continue
        meta = get_extraction_metadata(str(video_dir))
        ann_path = video_dir / "annotations.json"
        bbox_count = 0
        saved_at = None
        if ann_path.exists():
            try:
                with open(ann_path) as f:
                    data = json.load(f)
                bboxes_by_frame = data.get("bboxesByFrame", {})
                bbox_count = sum(len(v) for v in bboxes_by_frame.values())
                saved_at = data.get("savedAt")
            except (json.JSONDecodeError, OSError):
                pass 
        videos.append({
            "video_name":  video_dir.name,
            "frame_count": frame_count,
            "frame_rate":  meta.get("fps", 30),
            "bbox_count":  bbox_count,
            "saved_at":    saved_at,
        })
    return sorted(videos, key=lambda v: v["video_name"])


# list all uploaded videos with annotations.json, to let user pick which project to export stats for
@app.get("/projects")
def list_projects():
    projects = []
    for video_dir in OUTPUT_DIR.iterdir():
        if not video_dir.is_dir():
            continue
        ann_path = video_dir / "annotations.json"
        if not ann_path.exists():
            continue
        with open(ann_path) as f:
            data = json.load(f)
        bboxes_by_frame = data.get("bboxesByFrame", {})
        all_bboxes = [b for bboxes in bboxes_by_frame.values() for b in bboxes]
        if not all_bboxes:  # skip projects with no annotations
            continue
        classes = list({b.get("className", "unknown") for b in all_bboxes})
        projects.append({ 
            "video_name":   video_dir.name,
            "frame_count":  len(bboxes_by_frame),
            "bbox_count":   len(all_bboxes),
            "class_count":  len(classes),
            "classes":      sorted(classes),
            "saved_at":     data.get("savedAt", "unknown"),
        })
    return sorted(projects, key=lambda p: p["video_name"])

# export class stats for video
@app.post("/stats/export")
async def export_stats_selected(payload: dict = Body(...)):
    video_names = payload.get("video_names", [])
    if not video_names:
        return {"error": "No projects selected."}

    all_rows = []
    for video_name in video_names:
        ann_path = OUTPUT_DIR / video_name / "annotations.json"
        if not ann_path.exists():
            continue
        with open(ann_path) as f:
            data = json.load(f)
        bboxes_by_frame = data.get("bboxesByFrame", {})
        all_rows.extend(compute_stats(video_name, bboxes_by_frame))

    if not all_rows:
        return {"error": "No annotations found for selected projects."}

    fieldnames = [
        "video", "class", "bbox_count", "pct_of_total",
        "frame_count", "pct_of_annotated_frames"
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(all_rows)
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=stats_export.csv"}
    )

# export target chips of videos selected
@app.post("/chips/export")
async def export_chips(payload: dict = Body(...)):
    video_names = payload.get("video_names", [])
    if not video_names:
        return {"error": "No projects selected."}

    CHIPS_DIR = DATA_DIR / "chips"
    total_chips = 0
    skipped = 0

    for video_name in video_names:
        ann_path = OUTPUT_DIR / video_name / "annotations.json"
        if not ann_path.exists():
            continue
        with open(ann_path) as f:
            data = json.load(f)

        bboxes_by_frame = data.get("bboxesByFrame", {})
        orig_w = data.get("origW")
        orig_h = data.get("origH")
        disp_w = data.get("dispW")
        disp_h = data.get("dispH")

        if not all([orig_w, orig_h]):
            skipped += 1
            continue

        # files marked "image" already hold original pixels. older ones are still display-space and need the saved dims to convert
        if data.get("coordSpace") == "image":
            scale_x = scale_y = 1.0
        elif all([disp_w, disp_h]):
            scale_x = orig_w / disp_w 
            scale_y = orig_h / disp_h
        else:
            skipped += 1
            continue

        for frame_idx_str, bboxes in bboxes_by_frame.items():
            frame_idx = int(frame_idx_str)
            frame_path = OUTPUT_DIR / video_name / f"{frame_idx + 1:07d}.jpg"
            if not frame_path.exists():
                continue

            img = Image.open(frame_path)

            for bbox in bboxes:
                cls = bbox.get("className", "unknown")
                x = bbox.get("x", 0) * scale_x
                y = bbox.get("y", 0) * scale_y
                w = bbox.get("width", 0) * scale_x
                h = bbox.get("height", 0) * scale_y

                left   = max(0, int(x))
                top    = max(0, int(y))
                right  = min(orig_w, int(x + w))
                bottom = min(orig_h, int(y + h))

                if right <= left or bottom <= top:
                    continue

                track_id = bbox.get("trackId")
                uid = bbox.get("id", "000000")[:6]
                track_str = f"t{track_id}" if track_id is not None else "tX"
                filename = f"{video_name}_frame{frame_idx:07d}_{track_str}_{uid}.jpg" # so we can track down and index specific target trackid if needed

                out_dir = CHIPS_DIR / cls
                out_dir.mkdir(parents=True, exist_ok=True)

                chip = img.crop((left, top, right, bottom))
                chip.save(out_dir / filename, quality=95)
                total_chips += 1

    return {"total_chips": total_chips, "skipped_videos": skipped}

# compute and cache osnet embeddings for all annotated bboxes in a video
@app.post("/embeddings/{video_name}")
async def compute_embeddings(video_name: str, payload: dict = Body(...)):
    force = payload.get("force", False) # if true, recompute even if cache exists

    ann_path = OUTPUT_DIR / video_name / "annotations.json"
    if not ann_path.exists():
        return {"error": "no annotations found. save the session at least once first"}

    try:
        with open(ann_path) as f:
            data = json.load(f)
    except json.JSONDecodeError:
        return {"error": "annotations.json is corrupt. delete it and re-annotate"}

    cache_path = OUTPUT_DIR / video_name / EMBEDDINGS_CACHE_FILE
    if cache_path.exists() and not force:
        with open(cache_path) as f:
            return {"status": "cached", "bbox_count": len(json.load(f))}

    bboxes_by_frame = data.get("bboxesByFrame", {})
    orig_w = data.get("origW")
    orig_h = data.get("origH")
    disp_w = data.get("dispW")
    disp_h = data.get("dispH")

    if not all([orig_w, orig_h]):
        return {"error": "missing image dims. re-save the session first"}

    # files marked "image" already hold original pixels, older ones don't
    if data.get("coordSpace") == "image":
        scale_x = scale_y = 1.0
    elif all([disp_w, disp_h]):
        scale_x = orig_w / disp_w 
        scale_y = orig_h / disp_h
    else:
        return {"error": "missing image dims. re-save the session first"}

    # collect all (frame_path, bbox_id, crop_box) tuples upfront on the main thread
    crops = [] # list of (frame_path, bbox_id, (left, top, right, bottom))
    for frame_idx_str, bboxes in bboxes_by_frame.items():
        frame_idx = int(frame_idx_str)
        frame_path= OUTPUT_DIR / video_name / f"{frame_idx + 1:07d}.jpg"
        if not frame_path.exists():
            continue
        for bbox in bboxes:
            bid = bbox.get("id")
            if not bid:
                continue
            x = bbox.get("x", 0) * scale_x
            y = bbox.get("y", 0) * scale_y
            w = bbox.get("width",  0) * scale_x
            h = bbox.get("height", 0) * scale_y
            left   = max(0, int(x))
            top    = max(0, int(y))
            right  = min(orig_w, int(x + w))
            bottom = min(orig_h, int(y + h))
            if right <= left or bottom <= top: # just in case there are bboxes with wrong geometry
                continue
            crops.append((frame_path, bid, (left, top, right, bottom)))

    # run osnet inference 
    def run_inference():
        from collections import defaultdict
        # group crops by frame so each frame is opened once, embedded, then released. keeps memory flat over long videos
        by_frame = defaultdict(list)
        for frame_path, bid, box in crops:
            by_frame[frame_path].append((bid, box))

        embeddings = {} # key: bbox_id, val: embedding vector
        done = 0
        for frame_path, items in by_frame.items():
            img = Image.open(frame_path).convert("RGB")
            chips = [img.crop(box) for _, box in items]
            vecs  = embed_chips(chips) # batched inside; never holds more than one batch of tensors
            for (bid, _), vec in zip(items, vecs):
                embeddings[bid] = vec
            done += len(items)
            print(f"embedding progress: {done}/{len(crops)} chips") # per-frame, so it actually updates
            # img and chips go out of scope each iteration, not retained
        return embeddings

    loop = asyncio.get_event_loop()
    embeddings = await loop.run_in_executor(None, run_inference)

    ids = list(embeddings.keys())
    vecs = np.array([embeddings[k] for k in ids], dtype=np.float32)
    np.savez_compressed(cache_path, ids=np.array(ids), embeddings=vecs)

    return {"status": "computed", "bbox_count": len(embeddings)}

# load embeddings from .npz cache and return dict of k=bbox_id, v=np.array
def load_embeddings_cache(cache_path: Path) -> dict:
    data = np.load(cache_path)
    embs = data["embeddings"]
    if embs.ndim != 2 or embs.shape[1] != EMBED_DIM: # stale osnet cache (512-d), refuse it
        print(f"embedding cache at {cache_path} has dim {embs.shape[1:] } != {EMBED_DIM}, ignoring (will recompute)")
        return {}
    return {str(bid): vec for bid, vec in zip(data["ids"], embs)}

# check if embedding cache exists for a video
@app.get("/embeddings-status/{video_name}")
def embeddings_status(video_name: str):
    cache_path = OUTPUT_DIR / video_name / EMBEDDINGS_CACHE_FILE
    if not cache_path.exists():
        return {"status": "idle"}
    count = len(np.load(cache_path, allow_pickle=True)["ids"])
    return {"status": "ready", "bbox_count": count}

# add annotation to outlier list
def add_outlier(outliers, flagged_ids, frame_idx, bbox_id, cls, reason, detail, timestamp):
    key = (bbox_id, reason)
    if key in flagged_ids:
        return
    flagged_ids.add(key)
    outliers.append({
        "frame_idx": frame_idx,
        "bbox_id":   bbox_id,
        "class":     cls,
        "reason":    reason,
        "detail":    detail,
        "timestamp": timestamp,
    })

# get all the outliers in the video
@app.post("/outliers/{video_name}")
async def detect_outliers(video_name: str, payload: dict = Body(...)):
    rare_pct_thresh = payload.get("rare_pct", 1.0) # how rare to consider annotation outlier
    emb_k           = payload.get("emb_k", 4.0) # flag nn distances this many MADs above the class median (higher = stricter)
    emb_min_area    = payload.get("emb_min_area", 32 * 32) # for chips too small to embed reliably, skip embedding
    min_trust_len   = payload.get("min_trust_len", 5) # only flag a visually-odd box if its track is <= 5 frames. a real object briefly in view still forms a 2+ frame track; a mislabel is usually a one-off
    fps             = payload.get("fps", 30)

    ann_path = OUTPUT_DIR / video_name / "annotations.json"
    if not ann_path.exists():
        return {"outliers": []}

    with open(ann_path) as f:
        data = json.load(f)

    bboxes_by_frame = data.get("bboxesByFrame", {})
    total_annotated_frames = len(bboxes_by_frame)
    if total_annotated_frames == 0:
        return {"outliers": []}

    # min-area gate needs real pixels. "image" files are already there, older
    # display-space ones get converted with the dims saved alongside
    orig_w = data.get("origW")
    orig_h = data.get("origH")
    disp_w = data.get("dispW")
    disp_h = data.get("dispH")
    if data.get("coordSpace") == "image":
        scale_x = scale_y = 1.0
    else:
        scale_x = orig_w / disp_w if (orig_w and disp_w) else 1.0
        scale_y = orig_h / disp_h if (orig_h and disp_h) else 1.0

    # load embedding cache if available
    cache_path = OUTPUT_DIR / video_name / EMBEDDINGS_CACHE_FILE
    embeddings = {}
    if cache_path.exists():
        embeddings = load_embeddings_cache(cache_path)

    # count how many frames each track spans, so we can tell a persistent object from a one-off box.
    track_frames = {} # trackId: set of frame_idx it appears in
    for frame_idx_str, bboxes in bboxes_by_frame.items():
        frame_idx = int(frame_idx_str)
        for bbox in bboxes:
            tid = bbox.get("trackId")
            if tid is None:
                continue
            track_frames.setdefault(tid, set()).add(frame_idx)

    # collect per-class data
    class_ratios = {} # list of (frame_idx, bbox_id, ratio)
    class_frame_sets = {} # set of frame_idx it appears in
    class_embeddings = {} # list of (frame_idx, bbox_id, vec, is_isolated) for rule 1

    for frame_idx_str, bboxes in bboxes_by_frame.items():
        frame_idx = int(frame_idx_str)
        for bbox in bboxes:
            cls = bbox.get("className", "unknown")
            w   = bbox.get("width", 0)
            h   = bbox.get("height", 0)
            bid = bbox.get("id")
            if h == 0:
                continue
            ratio = w / h
            if cls not in class_ratios:
                class_ratios[cls]     = []
                class_frame_sets[cls] = set()
                class_embeddings[cls] = []
            class_ratios[cls].append((frame_idx, bid, ratio))
            class_frame_sets[cls].add(frame_idx) # track which frames this class appears in
            orig_area = (w * scale_x) * (h * scale_y) # chip size in original image px
            if bid and bid in embeddings and orig_area >= emb_min_area: # tiny chips embed to noise, so skip them here
                tid = bbox.get("trackId")
                # isolated = tracker linked this box to a track no longer than min_trust_len frames.
                track_len = len(track_frames.get(tid, set())) if tid is not None else 10**9 # manually drawn boxes have no id, so are given 10**9 len and not flagged for "isolated"
                is_isolated = track_len <= min_trust_len
                class_embeddings[cls].append((frame_idx, bid, np.array(embeddings[bid]), is_isolated))

    flagged_ids = set()
    outliers    = []

    for cls, entries in class_ratios.items():

        # rule 1: embedding distance to nearest same-class neighbour, gated by track isolation
        emb_entries = class_embeddings.get(cls, [])
        if len(emb_entries) >= 5: # need a few samples for "nearest neighbour" to mean anything
            vecs = np.stack([v for _, _, v, _ in emb_entries])
            sims = vecs @ vecs.T # cosine similarity
            np.fill_diagonal(sims, -np.inf) # ignore itself
            nn_dist = 1.0 - sims.max(axis=1) # cosine dist to nearest neighbour of this class
            med = np.median(nn_dist) # median nn distance for this class
            mad = np.median(np.abs(nn_dist - med)) + 1e-8 # mean absolute variance (MAD)
            threshold = med + emb_k * 1.4826 * mad 
            for (frame_idx, bbox_id, _, is_isolated), dist in zip(emb_entries, nn_dist): # loop thru all frames 
                dist = float(dist)
                seconds   = frame_idx / fps
                timestamp = f"{int(seconds // 3600):02d}:{int((seconds % 3600) // 60):02d}:{int(seconds % 60):02d}"
                if dist >= threshold and is_isolated: # visually too different AND not anchored to a real track
                    add_outlier(outliers, flagged_ids, frame_idx, bbox_id, cls, "embedding",
                        f"cosine dist={dist:.3f} to nearest {cls} ({(dist-med)/(1.4826*mad):.1f} MADs above median), track-isolated", timestamp)
                        
        # rule 2: rare class
        frame_pct = len(class_frame_sets[cls]) / total_annotated_frames * 100
        if frame_pct <= rare_pct_thresh: # if seen too little times, probably outlier too
            for frame_idx, bbox_id, _ in entries:
                seconds   = frame_idx / fps
                timestamp = f"{int(seconds // 3600):02d}:{int((seconds % 3600) // 60):02d}:{int(seconds % 60):02d}"
                add_outlier(outliers, flagged_ids, frame_idx, bbox_id, cls, "rare_class",
                    f"appears in {frame_pct:.2f}% of frames (threshold {rare_pct_thresh}%)", timestamp)

    outliers.sort(key=lambda x: x["frame_idx"]) # sort by frame so sidebar is in order
    return {"outliers": outliers}