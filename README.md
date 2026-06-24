# CV Annotator

A minimum viable product (MVP) annotation GUI to demonstrate how the annotation process can be made more efficient, built with React + FastAPI.

---

## File Structure

```
annotation-tool/
├── frontend/                               React + Vite
│   └── src/
│       ├── App.jsx
│       ├── store.js                        Zustand store
│       ├── constants.js                    Shared constants (palette, default tags, quality presets)
│       ├── main.jsx
│       └── components/
│           ├── AnnotationCanvas.jsx        Konva canvas: drawing, selecting, dragging bboxes
│           ├── LeftSidebar.jsx             Classes, tags, and model
│           ├── Toolbar.jsx                 Upload, import/export, save, mode toggle, quality
│           ├── VideoScrubber.jsx           Playback controls and frame scrubber
│           ├── RightSidebar.jsx            Annotation list and outlier detection panel
│           ├── ContextMenu.jsx             Right-click floating menu
│           └── ProjectModal.jsx            Project picker for Export Stats and Export Chips
├── backend/                                FastAPI + Uvicorn
│   ├── main.py
│   ├── bytetrack.py
│   └── requirements.txt
├── models/
│   ├── yolov7/                             Trimmed YOLOv7 repo
│   └── yolov7-tiny-visdrone.pt             Finetuned VisDrone weights
├── data/
│   ├── input/                              uploaded videos
│   └── output/                             extracted frames + annotations per video
│   │   └── {video_name}/
│   │       ├── 0000001.jpg
│   │       ├── ...
│   │       ├── annotations.json            Saved bboxes, classes, colors, image dims, timestamp
│   │       ├── extraction_metadata.json    JPEG quality setting used for frame extraction
│   │       └── yolo_raw_cache.json         Cached YOLO detections at conf=0.01 (generated on first run)
│   │       └── embeddings.json             Cached OSNet embeddings per bbox
│   └── chips/                              Exported bbox target chips, sorted by class
│       └── {class_name}/
│           └── {video_name}_frame{idx:07d}_{trackId}_{uuid[:6]}.jpg
├── .gitignore
└── README.md
```

---

## Setup

### 1. Model Setup

The finetuned YOLOv7-tiny weights (`yolov7-tiny-visdrone.pt`) are included in the `models/` folder and trained on the [VisDrone2019](https://github.com/VisDrone/VisDrone-Dataset) dataset. No download needed.

The model is a finetuned version of [YOLOv7-tiny](https://github.com/WongKinYiu/yolov7) by WongKinYiu, trained to detect the following VisDrone classes: `pedestrian`, `people`, `bicycle`, `car`, `van`, `truck`, `tricycle`, `awning-tricycle`, `bus`, `motor`, `others`.

The trimmed YOLOv7 repo is also already included at `models/yolov7/`.

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

## Tracking + Re-ID

Run via the **Run Tracking + Re-ID** button in the Models panel (left sidebar).

This runs the same ByteTrack pipeline as Run YOLOv7-tiny, but additionally embeds each
detection with OSNet and blends visual similarity into the association
cost. This helps keep track IDs stable through crossings and brief overlaps, where
IoU-only tracking tends to swap IDs.

It works on a fresh video in one press. It builds the YOLO cache itself if needed, so
there is no separate prerequisite step. Embeddings are computed live from the frames
during tracking; the plain Run YOLOv7-tiny button does not embed and stays fast.

**Note:** embedding every detection is significantly slower than plain tracking, especially
on CPU. GPU is strongly recommended for long footage.

---

## Box Propagation

Propagate a single manually-drawn bbox forward across subsequent frames. Select a bbox
and either press **P** or click **Propagate forward (P)** in the context menu.

This seeds a CSRT single-object tracker on the drawn box and follows the object frame-by-frame by appearance. Each propagated box is written across the frames it survives on, carrying a `propagated` tag so it shows up in the annotation list and on the canvas label. Propagation is undoable (Ctrl+Z).

Because CSRT follows appearance, it does not reliably know when it has lost the object. Once the target leaves the frame it tends to drift onto background or hop to a nearby object. Propagation therefore stops automatically when any of the following fire, and the reason is reported back in the result:

| Stop reason      | What triggered it                                                           |
| ---------------- | --------------------------------------------------------------------------- |
| appearance_drift | Tracked patch no longer resembles the seeded object (OSNet cosine distance) |
| frame_edge       | Object has mostly left the frame (visible fraction dropped below threshold) |
| area_jump        | Box area ballooned or collapsed vs the seed (catastrophic tracking failure) |
| position_jump    | Box jumped further in one frame than the object possibly could              |
| tracker_lost     | CSRT's own update reported failure                                          |
| end              | Reached the end of the video without any disappearance                      |

---

## Outlier Detection

Run on demand via the **Scan for Outliers** button in the right sidebar (Outlier Detection panel).

Flagged bboxes are highlighted in **amber (#ffcc00)** on the canvas and marked with ⚠ in the annotation list. The scrubber also shows amber tick marks at flagged frames - click any tick to jump to that frame.

**Detection rules:**

| Rule       | What it checks                                                                                                                                                                                                                                                                                                                                 | Configurable                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Embedding  | Flags a bbox that is BOTH visually unlike other bboxes of its class AND not anchored to a real track. Visual distance is the OSNet cosine distance to the nearest same-class neighbour, flagged when it exceeds the class median by k MADs. Requires Compute Embeddings to have been run; tiny chips and manually drawn boxes are not flagged. | Sens slider (2.0–8.0, default 4.0; higher = stricter) |
| Rare class | Flags all bboxes of a class that appears in suspiciously few frames - likely a misclick or misclassification                                                                                                                                                                                                                                   | Rare % slider (0.1–5.0%, default 1.0%)                |

The Embedding rule requires OSNet embeddings to be computed first via the **Compute Embeddings**
button (same panel). The status indicator shows idle / computing / ready. The Rare class rule
works without embeddings.

---

## Keyboard Shortcuts & Controls

| Key                | Action                          |
| ------------------ | ------------------------------- |
| W                  | Toggle select/draw mode         |
| Esc                | Cancel bbox drawing             |
| P                  | Propagate selected bbox forward |
| Arrow Left/Right   | Previous/next frame             |
| , / .              | Jump back/forward by N frames   |
| Space              | Play/pause                      |
| Delete / Backspace | Delete selected bbox(es)        |
| Ctrl+A             | Select all boxes on frame       |
| Ctrl+Z             | Undo                            |
| Ctrl+Y             | Redo                            |
| Ctrl+C             | Copy selected boxes             |
| Ctrl+V             | Paste copied boxes              |
| Ctrl+S             | Save                            |

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

| Input                      | Action                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| Left click                 | Select a bbox                                                             |
| Double click               | Resize existing bbox                                                      |
| Shift + Left click         | Add/remove bbox from selection                                            |
| Left click + drag (canvas) | Rubber band select multiple bboxes                                        |
| Ctrl + A                   | Select all bboxes on current frame                                        |
| Left click + drag (bbox)   | Move selected bbox(es)                                                    |
| Backspace / Delete         | Delete selected bbox(es)                                                  |
| Right click                | Open context menu (change class, add tags, propagate box forward, delete) |

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
- [x] Select a manually drawn bbox, then find all similar instances of it in the subsequent frames and populate the bbox via a CSRT object tracker, auto stopping when the object disappears.
- [ ] Select an existing bbox, mark it as a FA, then auto remove all similar instances in subsequent frames via template-matching or similar algorithms.
- [x] Outlier detection algorithm based on annotated classes to identify which annotations for that class could be wrong.
- [x] Embedding-based outlier detection (OSNet visual distance, gated by track isolation).
- [x] Visual re-ID for tracking (OSNet embeddings blended into ByteTrack association).
- [ ] Use (any variant of) SAM (https://github.com/facebookresearch/segment-anything) to tighten bounding boxes on demand for all bboxes in a frame.
- [x] Summarise the class label distribution stats for each project/ across all projects and export in csv format.
- [x] Extract and export bbox target chips by saving them in respective class folders.

---
