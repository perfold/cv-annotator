from fastapi import FastAPI, File, UploadFile, Body
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import json
from pathlib import Path
import subprocess

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = "../data"
INPUT_DIR = os.path.join(DATA_DIR, "input")
OUTPUT_DIR = os.path.join(DATA_DIR, "output")

JPEG_QUALITY = 15 # 1 (highest quality) to 31 (lowest quality)
EXTRACTION_METADATA_FILE = "extraction_metadata.json"

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
def save_extraction_metadata(output_folder: str):
    path = Path(output_folder) / EXTRACTION_METADATA_FILE
    with open(path, "w") as f:
        json.dump({"quality": JPEG_QUALITY}, f)

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
def extract_frames(video_path: str, output_folder: str) -> int:
    Path(output_folder).mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-i", video_path,
            "-q:v", str(JPEG_QUALITY),
            os.path.join(output_folder, "%07d.jpg"),
        ],
        check=True,
        capture_output=True,
    )
    save_extraction_metadata(output_folder)
    return len(list(Path(output_folder).glob("*.jpg")))

@app.post("/upload-video")

# function that takes in video upload, and breaks it up into individual frames
# if jpeg quality variable changed, re-extract
async def upload_video(file: UploadFile = File(...)):
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
    quality_changed = get_extraction_metadata(output_folder).get("quality") != JPEG_QUALITY

    if already_extracted and not quality_changed:
        frame_count = len(list(Path(output_folder).glob("*.jpg")))
    else:
        if already_extracted:  # wipe stale frames before re-extracting
            for f in Path(output_folder).glob("*.jpg"):
                f.unlink()
        frame_count = extract_frames(video_path, output_folder)

    return {
        "video_name": video_name,
        "frame_count": frame_count,
        "frame_rate": fps,
    }

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