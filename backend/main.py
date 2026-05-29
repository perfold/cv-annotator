from fastapi import FastAPI, File, UploadFile, Body, Form
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import json
import subprocess
import sys
from pathlib import Path
from bytetrack import ByteTracker
import csv
import io
from PIL import Image

# paths
BASE_DIR     = Path(__file__).parent.parent
DATA_DIR     = BASE_DIR / "data"
INPUT_DIR    = DATA_DIR / "input"
OUTPUT_DIR   = DATA_DIR / "output"
MODELS_DIR   = BASE_DIR / "models"
YOLOV7_PATH  = MODELS_DIR / "yolov7"
YOLO_WEIGHTS = MODELS_DIR / "yolov7-tiny.pt"

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
    frame_path = os.path.join(OUTPUT_DIR, video_name, f"{frame_idx + 1:07d}.jpg")
    return FileResponse(frame_path)


# function to save annotations
@app.post("/save/{video_name}")
async def save_annotations(video_name: str, payload: dict = Body(...)):
    path = os.path.join(OUTPUT_DIR, video_name, "annotations.json")
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    return {"status": "saved"}

# function to load annotations from prev save
@app.get("/load/{video_name}")
async def load_annotations(video_name: str):
    path = os.path.join(OUTPUT_DIR, video_name, "annotations.json")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)

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

        for path, img, im0, _ in dataset:
            frame_idx = int(Path(path).stem) - 1
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
    detections = {}

    for frame_idx in sorted(raw_cache.keys()):
        frame_dets = [d for d in raw_cache[frame_idx] if d["confidence"] >= conf_thres]
        if not frame_dets:
            continue
        # tracker adds 'track_id' to each det in-place
        tracked = tracker.update([dict(d) for d in frame_dets])
        detections[frame_idx] = tracked

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