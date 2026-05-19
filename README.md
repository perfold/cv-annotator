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

## Progress
### Basic Features
- [x] Function for user to upload video sequence for annotation (video will be auto split into frames in the annotation tool) 
- [x] Function to add configurable class labels for the video sequence/project 
- [x] Function to step forwards and backwards between frames 
- [ ] Function to manually draw upright bboxes 
- [ ] Function to add configurable tags to bboxes (e.g. of tags: occluded, blur)
- [ ] Function to zoom in/out of image
- [ ] Function to drag and pan around image 
- [ ] Function to save annotation progress and resume later 
- [ ] Function to export final annotations in “CVAT for Video” .xml format 
- [ ] Function to group shift all bboxes in a single frame at once 
 
### Advanced Features
- [ ] Function for user to upload and run YOLOv7-tiny (https://github.com/WongKinYiu/yolov7) object detection model – to prepopulate the data with bboxes (and class labels) on demand. 
- [ ] Function to select a manually drawn bbox, then find all similar instances of it in the subsequent frames and populate the bbox via template-matching or similar algorithms. 
- [ ] Function to select an existing bbox, mark it as a FA, then auto remove all similar instances in subsequent frames via template-matching or similar algorithms. 
- [ ] Some outlier detection algorithm based on annotated classes to identify which annotations for that class could be wrong. 
- [ ] Function to use (any variant of) SAM (https://github.com/facebookresearch/segment-anything) to tighten bounding boxes on demand for all bboxes in a frame. 
- [ ] Function to summarise the class label distribution stats for each project/ across all projects and export in csv format. 
- [ ] Function to extract and export bbox target chips by saving them in respective class folders. 