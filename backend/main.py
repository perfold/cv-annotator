from fastapi import FastAPI, File, UploadFile, Body, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import json
import subprocess
import sys
from pathlib import Path
from bytetrack import ByteTracker

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