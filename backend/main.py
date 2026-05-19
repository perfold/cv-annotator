from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import os
import cv2

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# diagnostic, to test if fastAPI is working
@app.get("/health")
def health():
    return {"status": "everything's working 👁️👄👁️"}

# function that takes in video upload, and breaks it up into individual frames
DATA_DIR = "../data"
INPUT_DIR = os.path.join(DATA_DIR, "input")
OUTPUT_DIR = os.path.join(DATA_DIR, "output")

def extract_frames(video_path, output_folder):
    os.makedirs(output_folder, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    frame_idx = 0

    while True:
        success, frame = cap.read()
        if not success:
            break
        cv2.imwrite(f"{output_folder}/{frame_idx:07d}.jpg", frame) # visdrone also uses 7 digit padding
        frame_idx += 1

    cap.release()
    return(frame_idx)

@app.post("/upload-video")

async def upload_video(file: UploadFile = File(...)):

    video_name = os.path.splitext(file.filename)[0]
    video_path = os.path.join(INPUT_DIR, file.filename)
    output_folder = os.path.join(OUTPUT_DIR, video_name)

    os.makedirs(INPUT_DIR, exist_ok=True)
    contents = await file.read()
    with open(video_path, "wb") as f:
        f.write(contents)

    frame_count = extract_frames(video_path, output_folder)

    return {
        "video_name": video_name,
        "frame_count": frame_count,
    }