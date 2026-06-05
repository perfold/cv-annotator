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

# paths
BASE_DIR     = Path(__file__).parent.parent
DATA_DIR     = BASE_DIR / "data"
INPUT_DIR    = DATA_DIR / "input"
OUTPUT_DIR   = DATA_DIR / "output"
MODELS_DIR   = BASE_DIR / "models"
YOLOV7_PATH  = MODELS_DIR / "yolov7"
YOLO_WEIGHTS = MODELS_DIR / "yolov7-tiny-visdrone.pt"

# check if repo and model are in the right dir
if not YOLOV7_PATH.exists():
    raise RuntimeError(f"YOLOv7 repo not found at {YOLOV7_PATH}.")
if not YOLO_WEIGHTS.exists():
    raise RuntimeError(f"YOLOv7-tiny weights not found at {YOLO_WEIGHTS}.")

sys.path.insert(0, str(YOLOV7_PATH))

import torch
from utils.datasets import LoadImages
from utils.general import non_max_suppression, scale_coords

# load yolov7-tiny
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
ckpt  = torch.load(str(YOLO_WEIGHTS), map_location=device, weights_only=False)
model = ckpt['model'].float().fuse().eval()
names  = model.module.names if hasattr(model, "module") else model.names
stride = int(model.stride.max())

# load osnet for visual embeddings 
import torchreid
from torchvision import transforms as T
osnet = torchreid.models.build_model('osnet_x0_25', num_classes=1000, pretrained=True) # 0_25 is a compressed version of the model, 0.2m params compared to full 2.2m
osnet = osnet.eval().to(device)

# osnet expects 256x128
_osnet_tf = T.Compose([
    T.Resize((256, 128)),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

EMBEDDINGS_CACHE_FILE = "embeddings.json" # {bbox_id: [float, ...]} per video

def embed_chip(img_crop): # run a single target chip through osnet, return normalised vector
    x   = _osnet_tf(img_crop.convert("RGB")).unsqueeze(0).to(device)
    with torch.no_grad():
        vec = osnet(x)[0].cpu().numpy().astype(float)
    vec /= np.linalg.norm(vec) + 1e-8 # l2-normalise so cosine dist = dot product
    return vec.tolist()

def embed_chips(img_crops, batch_size=64): # batched for embedding, much faster
    if not img_crops:
        return []
    out = []
    for i in range(0, len(img_crops), batch_size):
        batch = torch.stack([_osnet_tf(c.convert("RGB")) for c in img_crops[i:i + batch_size]]).to(device)
        with torch.no_grad(): 
            vecs = osnet(batch).cpu().numpy().astype(float) 
        vecs /= (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-8) # l2-normalise each row
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
def save_extraction_metadata(output_folder: str, quality: int):
    path = Path(output_folder) / EXTRACTION_METADATA_FILE
    with open(path, "w") as f:
        json.dump({"quality": quality}, f)

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
def extract_frames(video_path: str, output_folder: str, quality:int) -> int:
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
    save_extraction_metadata(output_folder, quality)
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
    else:
        if already_extracted: # wipe stale frames before re-extracting
            for f in Path(output_folder).glob("*.jpg"):
                f.unlink()
        frame_count = extract_frames(video_path, output_folder, quality)

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
    match_thresh = payload.get("match_thresh", 0.5)
    max_lost     = payload.get("max_lost", 60)

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

    # filter out dets according to conf level set by user, then run bytetrack
    tracker    = ByteTracker(track_thresh=conf_thres, match_thresh=match_thresh, max_lost=max_lost)

    # load embedding cache if requested
    use_embeddings = payload.get("use_embeddings", False)

    frame_files = sorted(frames_dir.glob("*.jpg"))

    def embed_frame_dets(frame_idx, dets):
        # embed every chip in the frame
        if frame_idx >= len(frame_files):
            return dets
        img = Image.open(frame_files[frame_idx]).convert("RGB") # convert once per frame, not per chip
        valid, crops = [], []
        for d in dets:
            left, top   = max(0, int(d["xtl"])), max(0, int(d["ytl"]))
            right, bot  = int(d["xbr"]), int(d["ybr"])
            if right <= left or bot <= top: # if weird shape, leave them embedding-less
                continue
            valid.append(d)
            crops.append(img.crop((left, top, right, bot)))
        for i, (d, vec) in enumerate(zip(valid, embed_chips(crops))):
            d["embedding"] = vec
            print(f"embedding progress: {i}/{len(crops)} chips")
        return dets

    def embed_and_track():
        result = {}
        for frame_idx in sorted(raw_cache.keys()):
            frame_dets = [d for d in raw_cache[frame_idx] if d["confidence"] >= conf_thres]
            if not frame_dets:
                continue
            dets = [dict(d) for d in frame_dets]
            if use_embeddings:
                dets = embed_frame_dets(frame_idx, dets) # attach visual embeddings for re-id matching
            # tracker adds 'track_id' to each det in-place
            tracked = tracker.update(dets)
            for d in tracked:
                d.pop("embedding", None)
            result[frame_idx] = tracked
        return result

    loop = asyncio.get_event_loop()
    detections = await loop.run_in_executor(None, embed_and_track)

    detected_classes = list({d["class_name"] for dets in detections.values() for d in dets})
    return {"detections": detections, "classes": detected_classes}

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

        if not all([orig_w, orig_h, disp_w, disp_h]):
            skipped += 1
            continue

        scale_x = orig_w / disp_w # make sure bbox properly aligns with target in image
        scale_y = orig_h / disp_h

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

    if not all([orig_w, orig_h, disp_w, disp_h]):
        return {"error": "missing image dims. re-save the session first"}

    scale_x = orig_w / disp_w # display-space bbox coords to original image space
    scale_y = orig_h / disp_h

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

    with open(cache_path, "w") as f:
        json.dump(embeddings, f)

    return {"status": "computed", "bbox_count": len(embeddings)}

# check if embedding cache exists for a video
@app.get("/embeddings-status/{video_name}")
def embeddings_status(video_name: str):
    cache_path = OUTPUT_DIR / video_name / EMBEDDINGS_CACHE_FILE
    if not cache_path.exists():
        return {"status": "idle"}
    with open(cache_path) as f:
        count = len(json.load(f))
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

    # display-space to original-image px, so the min-area gate is in real pixels (defaults to 1 if dims missing)
    orig_w = data.get("origW")
    orig_h = data.get("origH")
    disp_w = data.get("dispW")
    disp_h = data.get("dispH")
    scale_x = orig_w / disp_w if (orig_w and disp_w) else 1.0
    scale_y = orig_h / disp_h if (orig_h and disp_h) else 1.0

    # load embedding cache if available
    cache_path = OUTPUT_DIR / video_name / EMBEDDINGS_CACHE_FILE
    embeddings = {}
    if cache_path.exists():
        with open(cache_path) as f:
            embeddings = json.load(f)

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