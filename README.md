# cv-annotator

A minimum viable product computer vision assisted annotation tool to demonstrate how the annotation process can be made more efficient.

---

## Interface

The UI is header-driven. Every button has a keyboard shortcut (shown in brackets) and the tool is designed to be keyboard-friendly.

- **Panels** (annotations, classes, tags, outliers) are windows you can open, close, drag by their title bar, and resize. Drop one within 150px of the left or right edge to dock it into a column; drop it anywhere else to leave it floating over the canvas. Two panels stacked in one column share a draggable divider that adjusts how much height each gets.
- **Popovers** (import, export, models) are menus that open centred and close on Escape or a click outside. While a popover is open its own keybinds take priority over the global ones.
- **Draw/Select** is a mode toggle, not a panel.

---

## File Structure

```
annotation-tool/
├── frontend/                               React + Vite
│   └── src/
│       ├── App.jsx
│       ├── store.js                        Zustand store
│       ├── constants.js                    Shared constants (palette, default tags, quality presets)
│       ├── keymap.js                       Single source of truth for every keyboard shortcut
│       ├── useHotkeys.js                   Central keydown handler, dispatches from keymap.js
│       ├── usePopoverKeys.js               Lets a popover register its scoped keys while open
│       ├── main.jsx
│       └── components/
│           ├── AnnotationCanvas.jsx        Konva canvas: drawing, selecting, dragging bboxes
│           ├── HeaderBar.jsx               Top bar: labels + shortcuts, mode toggle
│           ├── Panel.jsx                   Draggable/resizable/dockable panel shell
│           ├── ColumnDivider.jsx           Adjustable vertical split between stacked panels
│           ├── Popover.jsx                 Selection menu
│           ├── VideoScrubber.jsx           Playback controls and frame scrubber
│           ├── ContextMenu.jsx             Right-click floating menu: change class, tags, propagate, mark FA, mark outlier, delete
│           ├── ProjectModal.jsx            Project picker for Export Stats and Export Chips
│           ├── panels/
│           │   ├── AnnotationsPanel.jsx    Annotation list + hide-all/only-flagged toggles
│           │   ├── ClassesPanel.jsx        Class list, colours, active class
│           │   ├── TagsPanel.jsx           Tag list and per-bbox tagging
│           │   └── OutliersPanel.jsx       Outlier detection sliders, scan, bulk removal
│           └── popovers/
│               ├── ImportPopover.jsx       Upload video, folder path, import XML, quality
│               ├── ExportPopover.jsx       Export XML/stats/chips, save
│               └── ModelsPopover.jsx       Run YOLO, embeddings, tracking, FastSAM
├── backend/                                FastAPI + Uvicorn
│   ├── main.py
│   ├── bytetrack.py
│   └── requirements.txt
├── models/
│   ├── yolov7/                             Trimmed YOLOv7 repo
│   ├── yolov7-tiny-visdrone-grouped.pt     Finetuned VisDrone weights
│   ├── dinov3-convnext-base/               DINOv3 ConvNeXt Base snapshot (via setup_dino.py)
│   ├── dinov3_convnext_base_mlp_head_supcon.pt   Trained SupCon MLP embedding head
│   └── FastSAM-x.pt                        FastSAM weights (via setup_sam.py)
├── data/
│   ├── input/                              uploaded videos
│   └── output/                             extracted frames + annotations per video
│   │   └── {video_name}/
│   │       ├── 0000001.jpg
│   │       ├── ...
│   │       ├── annotations.json            Saved bboxes, classes, colors, image dims, timestamp
│   │       ├── extraction_metadata.json    JPEG quality setting used for frame extraction
│   │       ├── yolo_raw_cache.json         Cached YOLO detections at conf=0.01 (generated on first run)
│   │       └── embeddings.json             Cached DINOv3 embeddings per bbox
│   └── chips/                              Exported bbox target chips, sorted by class
│       └── {class_name}/
│           └── {video_name}_frame{idx:07d}_{trackId}_{uuid[:6]}.jpg
├── setup_dino.py                           Downloads the DINOv3 snapshot (run once, online)
├── setup_sam.py                            Downloads FastSAM-x.pt (run once, online)
├── .gitignore
└── README.md
```

---

## Setup

### 1. Model Setup

The finetuned YOLOv7-tiny weights (`yolov7-tiny-visdrone-grouped.pt`) are included in the `models/` folder and trained on the [VisDrone2019](https://github.com/VisDrone/VisDrone-Dataset) dataset. No download needed.

The model is a finetuned version of [YOLOv7-tiny](https://github.com/WongKinYiu/yolov7) by WongKinYiu, trained to detect the following classes: `human`, `2-wheeler`, `3-wheeler`, `small-vehicle`, `bus`, `truck`.

The trimmed YOLOv7 repo is also already included at `models/yolov7/`.

The visual embedding model (DINOv3 ConvNeXt Base) and FastSAM weights are **not** bundled. Download them once while online:

```
python setup_dino.py   # fetches models/dinov3-convnext-base/
python setup_sam.py    # fetches models/FastSAM-x.pt
```

Embeddings run DINOv3 ConvNeXt Base as a frozen backbone with a trained SupCon MLP head (`dinov3_convnext_base_mlp_head_supcon.pt`). Once the snapshot is present the backend loads it offline.

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

Run YOLOv7-tiny on all frames via the **Run YOLOv7-tiny** button in the Models popover (**M**, then **Y**).

**Detection Parameter (adjustable via slider):**

| Parameter | What it does                       | Default | Tune if...                                                    |
| --------- | ---------------------------------- | ------- | ------------------------------------------------------------- |
| Conf      | Min confidence to keep a detection | 0.25    | Too many false positives → raise. Missing detections → lower. |

**Caching:** YOLO inference runs once per video and is cached to `data/output/{video_name}/yolo_raw_cache.json` at conf=0.01.

Adjusting Conf and re-running skips inference and just re-filters the cached detections at the new threshold. To force a full re-run, delete the cache file. Inference runs on GPU if available, CPU otherwise.

---

## Tracking + Re-ID

Run via the **Run Tracking + Re-ID** button in the Models popover (**M**, then **T**).

This runs ByteTrack with re-ID on all the frames. It requires the embeddings to be computed first via the **Compute Embeddings** button (**M**, then **E**).

**Tracking parameters (adjustable via sliders):**

| Parameter | What it does                                         | Default | Tune if...                                                                  |
| --------- | ---------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| Match     | Min IoU to confirm a track-detection pair            | 0.5     | IDs switching on fast-moving objects → lower. Wrong merges → raise.         |
| Max lost  | Frames a lost track stays alive before being dropped | 90      | IDs changing after brief occlusion → raise. Ghost tracks lingering → lower. |

**Note:** embedding every detection is significantly slower than plain tracking, especially on CPU, so using a GPU is strongly recommended.

---

## Box Propagation

Propagate a single manually-drawn bbox forward across subsequent frames. Select a bbox and either press **P** or click **Propagate forward (P)** in the context menu.

This seeds a CSRT single-object tracker on the drawn box and follows the object frame-by-frame by appearance. Each propagated box is written across the frames it survives on, carrying a `propagated` tag so it shows up in the annotation list and on the canvas label. Propagation is undoable (Ctrl+Z).

Because CSRT follows appearance, it does not reliably know when it has lost the object. Once the target leaves the frame it tends to drift onto background or hop to a nearby object. Propagation therefore stops automatically when any of the following fire, and the reason is reported back in the result:

| Stop reason       | What triggered it                                                            |
| ----------------- | ---------------------------------------------------------------------------- |
| appearance_drift  | Tracked patch no longer resembles the seeded object (DINOv3 cosine distance) |
| frame_edge        | Object has mostly left the frame (visible fraction dropped below threshold)  |
| area_jump         | Box area ballooned or collapsed vs the seed (catastrophic tracking failure)  |
| position_jump     | Box jumped further in one frame than the object possibly could               |
| tracker_lost      | CSRT's own update reported failure                                           |
| frame_read_failed | A frame could not be read from disk                                          |
| end               | Reached the end of the video without any disappearance                       |

---

## False Alarm (FA) Removal

Mark a persistently mis-detected or spurious object as a false alarm across frames, then bulk-delete all marked boxes. Select a bbox and either press **F** or click **Mark as FA (F)** in the context menu.

This works similarly to the bbox propagation feature, but instead of drawing new boxes, it reclasses the seed box and every matched box to a reserved `false-alarm` class across all frames. It stops on the same disappearance guards as propagation (appearance_drift, frame_edge, area_jump, position_jump, tracker_lost, frame_read_failed, end).

**Same class only (context-menu toggle):**

| Toggle       | Behaviour                                            | Use case                                                                                                                                                          |
| ------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On (default) | Only reclasses boxes whose class matches the seed    | A real object persistently mislabelled as one wrong class (e.g. a motorcycle detected as `bicycle`). It reclasses only the wrong-class boxes, leaves correct ones |
| Off          | Reclasses whatever box the track overlaps, any class | A messy detection which has a label that flickers across frames (e.g. `car` / `van` / `truck` on the same vehicle)                                                |

Boxes in the `false-alarm` class are drawn with a higher fill and a diagonal cross on the canvas (in FA colour, #750000), and show as `false-alarm` in the annotation list. Reclassing and removal are both undoable (Ctrl+Z).

Click **Remove all FA** in the Outlier Detection panel (or press **D**) to delete every box in the `false-alarm` class across all frames in one pass.

---

## Outlier Detection

Run on demand via the **Scan for Outliers** button in the Outlier Detection panel (**O** to open the panel, **S** to scan).

Flagged bboxes are highlighted in **magenta (#ff00ff)** on the canvas and marked with ⚠ in the annotation list. The scrubber also shows amber tick marks at flagged frames - click any tick to jump to that frame.

**Detection rules:**

| Rule       | What it checks                                                                                                                                                                                                                                                                                                                                  | Configurable                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Embedding  | Flags a bbox that is BOTH visually unlike other bboxes of its class AND not anchored to a real track. Visual distance is the DINOv3 cosine distance to the nearest same-class neighbour, flagged when it exceeds the class median by k MADs. Requires Compute Embeddings to have been run; tiny chips and manually drawn boxes are not flagged. | Sens slider (2.0–8.0, default 4.0; higher = stricter) |
| Rare class | Flags all bboxes of a class that appears in suspiciously few frames - likely a misclick or misclassification                                                                                                                                                                                                                                    | Rare % slider (0.1–5.0%, default 1.0%)                |

The Embedding rule requires DINOv3 ConvNeXt embeddings to be computed first via the **Compute Embeddings** button in the Models popover. The Rare class rule works without embeddings.

---

## Keyboard Shortcuts & Controls

Every header label is a shortcut. Keys are single presses (no modifier) unless noted. While a popover is open its keys take priority over the global ones.

### Global

| Key                | Action                            |
| ------------------ | --------------------------------- |
| I                  | Open Import popover               |
| X                  | Open Export popover               |
| M                  | Open Models popover               |
| A                  | Toggle Annotations panel          |
| C                  | Toggle Classes panel              |
| T                  | Toggle Tags panel                 |
| O                  | Toggle Outlier Detection panel    |
| W                  | Toggle select/draw mode           |
| H                  | Hide all bboxes                   |
| L                  | Show only flagged (outliers/FA)   |
| P                  | Propagate selected bbox forward   |
| F                  | Mark selected bbox as FA          |
| G                  | Mark selected bbox as outlier     |
| S                  | Scan for outliers                 |
| R                  | Remove all outliers               |
| D                  | Remove all FA                     |
| Esc                | Cancel bbox drawing/close popover |
| Arrow Left/Right   | Previous/next frame               |
| , / .              | Jump back/forward by N frames     |
| Space              | Play/pause                        |
| Delete / Backspace | Delete selected bbox(es)          |
| Ctrl+A             | Select all boxes on frame         |
| Ctrl+Z             | Undo                              |
| Ctrl+Y             | Redo                              |
| Ctrl+C             | Copy selected boxes               |
| Ctrl+V             | Paste copied boxes                |
| Ctrl+S             | Save                              |

> N is the frame interval, adjustable in the UI (default: 10)

### Import popover (open with I)

| Key   | Action                          |
| ----- | ------------------------------- |
| U     | Upload video                    |
| X     | Import XML                      |
| P     | Enter the file path input field |
| 1/2/3 | Quality low/medium/high         |

### Export popover (open with X)

| Key | Action       |
| --- | ------------ |
| X   | Export XML   |
| S   | Export stats |
| C   | Export chips |
| V   | Save         |

### Models popover (open with M)

| Key | Action                       |
| --- | ---------------------------- |
| Y   | Run YOLOv7-tiny              |
| E   | Compute/recompute embeddings |
| T   | Run tracking + re-ID         |
| B   | FastSAM tighten boxes        |
| P   | FastSAM polygon              |

## Zoom & Image Navigation

| Input                         | Action                             |
| ----------------------------- | ---------------------------------- |
| Scroll wheel up               | Zoom in (toward cursor)            |
| Scroll wheel down             | Zoom out (min 1x, max 10x)         |
| Double-click canvas           | Reset zoom and position to default |
| Ctrl + drag/Middle mouse drag | Pan around canvas                  |

### Draw Mode

| Input             | Action                               |
| ----------------- | ------------------------------------ |
| Left click        | Place first corner of bbox           |
| Double left click | Place opposite corner, finalize bbox |

### Select Mode

| Input                      | Action                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Left click                 | Select a bbox                                                                        |
| Double click               | Resize existing bbox                                                                 |
| Shift + Left click         | Add/remove bbox from selection                                                       |
| Left click + drag (canvas) | Rubber band select multiple bboxes                                                   |
| Ctrl + A                   | Select all bboxes on current frame                                                   |
| Left click + drag (bbox)   | Move selected bbox(es)                                                               |
| Backspace / Delete         | Delete selected bbox(es)                                                             |
| Right click                | Open context menu (change class, add tags, propagate, mark FA, mark outlier, delete) |

---
