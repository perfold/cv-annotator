import cv2
import os

video_path = "../data/crosspath_test.mp4"
video_name = os.path.splitext(os.path.basename(video_path))[0]
output_folder = f"../data/{video_name}"
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
print(f"broke {video_name} into {frame_idx} frames")