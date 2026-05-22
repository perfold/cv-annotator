from fastapi import FastAPI, File, UploadFile, Body
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import cv2
import json

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

def extract_frames(video_path, output_folder):
    os.makedirs(output_folder, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_idx = 0

    while True:
        success, frame = cap.read()
        if not success:
            break
        cv2.imwrite(f"{output_folder}/{frame_idx:07d}.jpg", frame) # visdrone also uses 7 digit padding
        frame_idx += 1

    cap.release()
    return(frame_idx, fps)

@app.post("/upload-video")

# function that takes in video upload, and breaks it up into individual frames
async def upload_video(file: UploadFile = File(...)):

    video_name = os.path.splitext(file.filename)[0]
    video_path = os.path.join(INPUT_DIR, file.filename)
    output_folder = os.path.join(OUTPUT_DIR, video_name)

    os.makedirs(INPUT_DIR, exist_ok=True)
    contents = await file.read()
    with open(video_path, "wb") as f:
        f.write(contents)

    frame_count, fps = extract_frames(video_path, output_folder)

    return {
        "video_name": video_name,
        "frame_count": frame_count,
        "frame_rate": fps, 
    }

# function to get frame
@app.get("/frame/{video_name}/{frame_idx}")
def get_frame(video_name: str, frame_idx: int):
    frame_path = os.path.join(OUTPUT_DIR, video_name, f"{frame_idx:07d}.jpg")
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