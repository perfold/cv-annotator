# CV Annotator

A minimum viable product (MVP) annotation GUI to demonstrate how the annotation process can be made more efficient, built with React + FastAPI.

---

## File Structure

```
annotation-tool/
├── frontend/                               React + Vite
│   └── src/
│       ├── App.jsx
│       ├── AnnotationCanvas.jsx
│       └── main.jsx
├── backend/                                FastAPI + Uvicorn
│   ├── main.py
│   └── requirements.txt
├── models/
│   ├── yolov7/                             Trimmed YOLOv7 repo
│   └── yolov7-tiny.pt                      YOLOv7-tiny weights (not committed, see setup)
├── data/
│   ├── input/                              uploaded videos
│   └── output/                             extracted frames + annotations per video
│   │   └── {video_name}/
│   │       ├── 0000001.jpg
│   │       ├── ...
│   │       ├── annotations.json            Saved bboxes, classes, colors, image dims, timestamp
│   │       ├── extraction_metadata.json    JPEG quality setting used for frame extraction
│   │       └── yolo_raw_cache.json         Cached YOLO detections at conf=0.01 (generated on first run)
│   └── chips/                              Exported bbox target chips, sorted by class
│       └── {class_name}/
│           └── {video_name}_frame{idx:07d}_{trackId}_{uuid[:6]}.jpg
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

Run YOLOv7-tiny on all frames via the **Run YOLOv7-tiny** button in the Models panel (left sidebar).

**Tracking Parameters (adjustable via sliders):**

| Parameter | What it does                                         | Default | Tune if...                                                                  |
| --------- | ---------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| Conf      | Min confidence to keep a detection                   | 0.25    | Too many false positives → raise. Missing detections → lower.               |
| Match     | Min IoU to confirm a track-detection pair            | 0.5     | IDs switching on fast-moving objects → lower. Wrong merges → raise.         |
| Max lost  | Frames a lost track stays alive before being dropped | 90      | IDs changing after brief occlusion → raise. Ghost tracks lingering → lower. |

**Caching:** YOLO inference runs once per video and is cached to `data/output/{video_name}/yolo_raw_cache.json`.

Adjusting Conf/Match/Max lost and re-running skips inference and only re-runs the trackerS. To force a full re-run, delete the cache file. Inference runs on GPU if available, CPU otherwise

---

## Outlier Detection

Run on demand via the **Scan for Outliers** button in the right sidebar (Outlier Detection panel).

Flagged bboxes are highlighted in **amber (#ffcc00)** on the canvas and marked with ⚠ in the annotation list. The scrubber also shows amber tick marks at flagged frames - click any tick to jump to that frame.

**Detection rules:**

| Rule         | What it checks                                                                                                                                | Configurable                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Orientation  | Flags bboxes whose w/h ratio violates the expected orientation for known COCO classes (e.g. `person` wider than tall, `car` taller than wide) | No - thresholds are fixed per class       |
| Aspect ratio | Flags bboxes whose w/h ratio is statistically unusual compared to other bboxes of the same class in the video (requires ≥10 samples)          | σ threshold slider (1.5–3.0, default 2.0) |
| Rare class   | Flags all bboxes of a class that appears in suspiciously few frames - likely a misclick or misclassification                                  | Rare % slider (0.1–5.0%, default 1.0%)    |

---

## Keyboard Shortcuts & Controls

| Key                | Action                        |
| ------------------ | ----------------------------- |
| W                  | Toggle select/draw mode       |
| Esc                | Cancel bbox drawing           |
| Arrow Left/Right   | Previous/next frame           |
| , / .              | Jump back/forward by N frames |
| Space              | Play/pause                    |
| Delete / Backspace | Delete selected bbox(es)      |
| Ctrl+A             | Select all boxes on frame     |
| Ctrl+Z             | Undo                          |
| Ctrl+Y             | Redo                          |
| Ctrl+C             | Copy selected boxes           |
| Ctrl+V             | Paste copied boxes            |
| Ctrl+S             | Save                          |

> N is the frame interval, adjustable in the UI (default: 10)

## Zoom & Image Navigation

| Input                           | Action                             |
| ------------------------------- | ---------------------------------- |
| Scroll wheel up                 | Zoom in (toward cursor)            |
| Scroll wheel down               | Zoom out (min 1x, max 10x)         |
| Double-click canvas             | Reset zoom and position to default |
| Ctrl + drag / Middle mouse drag | Pan around canvas                  |

---

### Annotation

`W` - toggle between **Select** and **Draw** mode

`Ctrl + S` - manually save annotations

### Draw Mode

| Input             | Action                               |
| ----------------- | ------------------------------------ |
| Left click        | Place first corner of bbox           |
| Double left click | Place opposite corner, finalize bbox |

### Select Mode

| Input                      | Action                                             |
| -------------------------- | -------------------------------------------------- |
| Left click                 | Select a bbox                                      |
| Double click               | Resize existing bbox                               |
| Shift + Left click         | Add/remove bbox from selection                     |
| Left click + drag (canvas) | Rubber band select multiple bboxes                 |
| Ctrl + A                   | Select all bboxes on current frame                 |
| Left click + drag (bbox)   | Move selected bbox(es)                             |
| Backspace / Delete         | Delete selected bbox(es)                           |
| Right click                | Open context menu (change class, add tags, delete) |

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
- [x] Outlier detection algorithm based on annotated classes to identify which annotations for that class could be wrong.
- [ ] Use (any variant of) SAM (https://github.com/facebookresearch/segment-anything) to tighten bounding boxes on demand for all bboxes in a frame.
- [x] Summarise the class label distribution stats for each project/ across all projects and export in csv format.
- [x] Extract and export bbox target chips by saving them in respective class folders.

---
