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
├── models/            YOLOv7 tiny, SAM weights (gitignored)
├── data/              (gitignored)
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

## How to Run
```
cd frontend
npm install       
npm run dev # to run React front end

cd backend
pip install -r requirements.txt
uvicorn main:app --reload # to run FastAPI backend

Open http://localhost:5173/ in your browser, to view the frontend
```

---

## Keyboard Shortcuts & Controls
### Video Navigation

| Key | Action |
|-----|--------|
| `←` | Go back 1 frame |
| `→` | Go forward 1 frame |
| `,` | Go back N frames |
| `.` | Go forward N frames |
| `Space` | Play / Pause |

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

`W` — toggle between **Select** and **Draw** mode\

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
- [ ] Upload and run YOLOv7-tiny (https://github.com/WongKinYiu/yolov7) object detection model – to prepopulate the data with bboxes (and class labels) on demand. 
- [ ] Select a manually drawn bbox, then find all similar instances of it in the subsequent frames and populate the bbox via template-matching or similar algorithms. 
- [ ] Select an existing bbox, mark it as a FA, then auto remove all similar instances in subsequent frames via template-matching or similar algorithms. 
- [ ] Outlier detection algorithm based on annotated classes to identify which annotations for that class could be wrong. 
- [ ] Use (any variant of) SAM (https://github.com/facebookresearch/segment-anything) to tighten bounding boxes on demand for all bboxes in a frame. 
- [ ] Summarise the class label distribution stats for each project/ across all projects and export in csv format. 
- [ ] Extract and export bbox target chips by saving them in respective class folders. 

---
