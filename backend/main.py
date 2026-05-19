from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse
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

# function that takes in video upload, and breaks it up into individual frames
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

# function to get frame
@app.get("/frame/{video_name}/{frame_idx}")
def get_frame(video_name: str, frame_idx: int):
    frame_path = os.path.join(OUTPUT_DIR, video_name, f"{frame_idx:07d}.jpg")
    return FileResponse(frame_path)