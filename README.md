# CV Annotator
A minimum viable product (MVP) annotation GUI to demonstrate how the annotation process can be made more efficient, built with React + FastAPI. 

## File Structure
```
annotation-tool/
├── frontend/          React + Vite
│   └── src/
│       ├── App.jsx
│       └── main.jsx
├── backend/           FastAPI + Uvicorn
│   ├── main.py
│   └── requirements.txt
├── models/            YOLOv7 tiny, SAM (gitignored)
├── data/              VisDrone dataset + extracted frames (gitignored)
├── .gitignore
└── README.md
```

## How to Run
```
cd frontend
npm install       
npm run dev # to run React front end

cd backend
pip install -r requirements.txt
uvicorn main:app --reload # to run FastAPI backend
```

## Controls
### Navigation
'&larr;': go back 1 frame\
'&rarr;': go forward 1 frame\
',': go back 10* frames\
'.': go forward 10* frames\
spacebar: play/pause video

*number of frames/interval can be changed

### Annotation
single left click: start bounding box drawing (corner)\
double left click: end bounding box drawing (opposite corner)\
single right click: launch bbox context menu, to change class/delete

## Progress
### Basic Features
- [x] Upload video sequence for annotation (video will be auto split into frames in the annotation tool) 
- [x] Add configurable class labels for the video sequence/project 
- [x] Change color of class label's bbox
- [x] Step forwards and backwards between frames 
- [x] Manually draw upright bboxes 
- [ ] Drag and move individual bbox
- [ ] Add configurable tags to bboxes (e.g. of tags: occluded, blur)
- [ ] Zoom in/out of image
- [ ] Drag and pan around image 
- [ ] Save annotation progress and resume later 
- [ ] Export final annotations in “CVAT for Video” .xml format 
- [ ] Group shift all bboxes in a single frame at once 
 
### Advanced Features
- [ ] Upload and run YOLOv7-tiny (https://github.com/WongKinYiu/yolov7) object detection model – to prepopulate the data with bboxes (and class labels) on demand. 
- [ ] Select a manually drawn bbox, then find all similar instances of it in the subsequent frames and populate the bbox via template-matching or similar algorithms. 
- [ ] Select an existing bbox, mark it as a FA, then auto remove all similar instances in subsequent frames via template-matching or similar algorithms. 
- [ ] Outlier detection algorithm based on annotated classes to identify which annotations for that class could be wrong. 
- [ ] Use (any variant of) SAM (https://github.com/facebookresearch/segment-anything) to tighten bounding boxes on demand for all bboxes in a frame. 
- [ ] Summarise the class label distribution stats for each project/ across all projects and export in csv format. 
- [ ] Extract and export bbox target chips by saving them in respective class folders. 