# CV Annotator
A minimum viable product (MVP) annotation GUI to demonstrate how the annotation process can be made more efficient, built with React + FastAPI. 

---

## File Structure
```
annotation-tool/
├── frontend/          React + Vite
│   └── src/
│       ├── App.jsx
│       ├── AnnotationCanvas.jsx
│       └── main.jsx
├── backend/           FastAPI + Uvicorn
│   ├── main.py
│   └── requirements.txt
├── models/            
│   ├── yolov7/        Trimmed YOLOv7 repo
│   └── yolov7-tiny.pt YOLOv7-tiny weights (not committed, see setup)
├── data/              
│   ├── input/         uploaded videos
│   └── output/        extracted frames + annotations per video
│       └── video_name/
│           ├── 0000001.jpg
│           ├── ...
│           └── annotations.json
├── .gitignore
└── README.md
```

---

## Setup

### 1. Model Setup (one-time)

The YOLOv7-tiny weights are not included in the repo as they are too large. Download them and place in the `models/` folder:

```
wget https://github.com/WongKinYiu/yolov7/releases/download/v0.1/yolov7-tiny.pt -O models/yolov7-tiny.pt
```

The models/yolov7 folder (trimmed) is already included in this repo.

### 2. Install Dependencies & Run

```
cd frontend
npm install       
npm run dev # to run React front end

cd backend
pip install -r requirements.txt
uvicorn main:app --reload # to run FastAPI backend

Open http://localhost:5173/ in your browser.
```

---

## YOLOv7-tiny Inference

With a video loaded, look at the **Models** panel in the left sidebar:

1. Adjust the **Conf** slider to set the confidence threshold (lower = more detections, higher = fewer but more accurate)
2. Click **Run YOLOv7-tiny** to run inference across all frames
3. Detected bboxes will be pre-populated across all frames automatically
4. Re-run at any time with a different confidence level to update detections (manually drawn annotations are preserved. only YOLO-generated boxes are replaced on re-runs)

Inference runs on GPU if available, CPU otherwise

---

## Keyboard Shortcuts & Controls

| Key | Action |
|-----|--------|
| W | Toggle select/draw mode |
| Esc | Cancel bbox drawing |
| Arrow Left/Right | Previous/next frame |
| , / . | Jump back/forward by N frames |
| Space | Play/pause |
| Delete / Backspace | Delete selected bbox(es) |
| Ctrl+A | Select all boxes on frame |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+C | Copy selected boxes |
| Ctrl+V | Paste copied boxes |
| Ctrl+S | Save |

> N is the frame interval, adjustable in the UI (default: 10)

## Zoom & Image Navigation

| Input | Action |
|-------|--------|
| Scroll wheel up | Zoom in (toward cursor) |
| Scroll wheel down | Zoom out (min 1x, max 10x) |
| Double-click canvas | Reset zoom and position to default |
| Ctrl + drag / Middle mouse drag | Pan around canvas |

---

### Annotation

`W` — toggle between **Select** and **Draw** mode

`Ctrl + S` — manually save annotations

### Draw Mode
| Input | Action |
|-------|--------|
| Left click | Place first corner of bbox |
| Double left click | Place opposite corner, finalize bbox |

### Select Mode
| Input | Action |
|-------|--------|
| Left click | Select a bbox |
| Shift + Left click | Add/remove bbox from selection |
| Left click + drag (canvas) | Rubber band select multiple bboxes |
| Ctrl + A | Select all bboxes on current frame |
| Left click + drag (bbox) | Move selected bbox(es) |
| Backspace / Delete | Delete selected bbox(es) |
| Right click | Open context menu (change class, add tags, delete) |

---

## Progress
### Basic Features
- [x] Upload video sequence for annotation (video will be auto split into frames in the annotation tool) 
- [x] Add configurable class labels for the video sequence/project 
- [x] Change color of class label's bbox
- [x] Step forwards and backwards between frames 
- [x] Manually draw upright bboxes 
- [x] Change class of existing bbox
- [x] Delete existing bbox
- [x] Drag and move individual bbox
- [x] Add configurable tags to bboxes (e.g. of tags: occluded, blur)
- [x] Zoom in/out of image
- [x] Drag and pan around image 
- [x] Save annotation progress and resume later 
- [x] Export final annotations in “CVAT for Video” .xml format 
- [x] Group shift all bboxes in a single frame at once 
 
### Advanced Features
- [x] Upload and run YOLOv7-tiny (https://github.com/WongKinYiu/yolov7) object detection model – to prepopulate the data with bboxes (and class labels) on demand. 
- [ ] Select a manually drawn bbox, then find all similar instances of it in the subsequent frames and populate the bbox via template-matching or similar algorithms. 
- [ ] Select an existing bbox, mark it as a FA, then auto remove all similar instances in subsequent frames via template-matching or similar algorithms. 
- [ ] Outlier detection algorithm based on annotated classes to identify which annotations for that class could be wrong. 
- [ ] Use (any variant of) SAM (https://github.com/facebookresearch/segment-anything) to tighten bounding boxes on demand for all bboxes in a frame. 
- [ ] Summarise the class label distribution stats for each project/ across all projects and export in csv format. 
- [ ] Extract and export bbox target chips by saving them in respective class folders. 

---
