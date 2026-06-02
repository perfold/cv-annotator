import { useEffect, useState, useRef } from "react";
import axios from "axios";
import AnnotationCanvas from "./AnnotationCanvas";

// global constants
const PALETTE = [
  // anotations will be auto assigned one of these colors
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#e91e63",
  "#00bcd4",
  "#ff5722",
  "#8bc34a",
  "#673ab7",
  "#ff9800",
  "#009688",
  "#cddc39",
];
const DEFAULT_TAGS = ["occluded", "blur", "cut-off", "image-error"]; // default tags

const QUALITY_PRESETS = { low: 31, medium: 15, high: 1 }; // extracted frames' jpg quality

function App() {
  // video states
  const [videoName, setVideoName] = useState(null);
  const [frameCount, setFrameCount] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [fps, setFps] = useState(30);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef(null);
  const [frameInterval, setFrameInterval] = useState(10); // user definable keyframe interval, 10 is default

  // export stats states
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [projectsList, setProjectsList] = useState([]);
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [showChipsModal, setShowChipsModal] = useState(false);
  const [isExportingChips, setIsExportingChips] = useState(false);

  // select/draw mode
  const [mode, setMode] = useState("select"); // toggle between select and draw mode
  const [showSaved, setShowSaved] = useState(false);
  const lastSavedRef = useRef(null);
  const imageDimsRef = useRef({ origW: 0, origH: 0, dispW: 0, dispH: 0 }); // export .xml

  // switch quality toggle
  const [quality, setQuality] = useState("low"); // set quality of extracted frames, default low
  const [isExtracting, setIsExtracting] = useState(false);

  // class labels
  const [classes, setClasses] = useState([]); // list of existing classes
  const [newClassName, setNewClassName] = useState(""); // temporary, to hold half-typed labels
  const [activeClass, setActiveClass] = useState(null); // currently selected class
  const [classColors, setClassColors] = useState({}); // custom colors for the classes

  // bbox states
  const [bboxesByFrame, setBboxesByFrame] = useState({}); // stores dict of frame:list of bbox
  const frameBboxes = bboxesByFrame[currentFrame] ?? [];
  const [selectedBboxIds, setSelectedBboxIds] = useState([]); // handles tracking of selected bboxes, to change classes/drag
  const [contextMenu, setContextMenu] = useState(null); // where to render floating menu, and for which bbox

  // bbox tags
  const [tags, setTags] = useState(DEFAULT_TAGS);
  const [newTagName, setNewTagName] = useState(""); // used to add custom tags for the bboxes

  // shortcut (ctrl z,y,c,v) states
  const pastRef = useRef([]); // undo stack
  const futureRef = useRef([]); // redo stack
  const clipboardRef = useRef([]);
  const stateRef = useRef({}); // keeps track of bbox states

  // model states
  const [yoloConf, setYoloConf] = useState(0.25); // confidence level, default is 0.25
  const [isRunningYolo, setIsRunningYolo] = useState(false);
  const [matchThresh, setMatchThresh] = useState(0.5); // bytetrack settings
  const [maxLost, setMaxLost] = useState(90);

  // outlier detection states
  const [outliers, setOutliers] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [sigmaThresh, setSigmaThresh] = useState(2.0);
  const [rarePctThresh, setRarePctThresh] = useState(1.0);
  const OUTLIER_COLOR = "#ffcc00";

  // format time into HH:MM:SS
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  // save and load annotations from data folder
  async function saveSession(videoName, bboxesByFrame, classes, classColors) {
    const { origW, origH, dispW, dispH } = imageDimsRef.current;
    await axios.post(`http://localhost:8000/save/${videoName}`, {
      bboxesByFrame,
      classes,
      classColors,
      origW,
      origH,
      dispW,
      dispH,
      savedAt: new Date().toISOString(),
    });
  }

  async function loadSession(videoName) {
    const res = await axios.get(`http://localhost:8000/load/${videoName}`);
    return Object.keys(res.data).length > 0 ? res.data : null;
  }

  // upload video function
  async function uploadVideo(file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("quality", QUALITY_PRESETS[quality]);

    const res = await axios.post(
      "http://localhost:8000/upload-video",
      formData,
    );
    setVideoName(res.data.video_name);
    setFrameCount(res.data.frame_count);
    setFps(res.data.frame_rate);
    setCurrentFrame(0);
    setBboxesByFrame({});
    setOutliers([]);
    pastRef.current = [];
    futureRef.current = [];

    // resume annotations
    const session = await loadSession(res.data.video_name);
    if (session) {
      const resume = window.confirm(
        `Resume previous session?\nLast saved: ${new Date(session.savedAt).toLocaleString()}`,
      );
      if (resume) {
        setBboxesByFrame(session.bboxesByFrame);
        setClasses(session.classes);
        setClassColors(session.classColors ?? {});
      }
    }
  }

  // load frames from folder
  async function loadFrameFolder(folderPath) {
    if (!folderPath) return;
    try {
      const res = await axios.post(
        "http://localhost:8000/load-frames-from-path",
        {
          folder_path: folderPath,
        },
      );
      if (res.data.error) {
        alert(res.data.error);
        return;
      }
      setVideoName(res.data.video_name);
      setFrameCount(res.data.frame_count);
      setFps(res.data.frame_rate);
      setCurrentFrame(0);
      setBboxesByFrame({});
      setOutliers([]);
      pastRef.current = [];
      futureRef.current = [];
      const session = await loadSession(res.data.video_name);
      if (session) {
        const resume = window.confirm(
          `Resume previous session?\nLast saved: ${new Date(session.savedAt).toLocaleString()}`,
        );
        if (resume) {
          setBboxesByFrame(session.bboxesByFrame);
          setClasses(session.classes);
          setClassColors(session.classColors ?? {});
        }
      }
    } catch (err) {
      alert("Failed to load folder: " + err.message);
    }
  }
  // run yolo on all frames
  async function runYolo() {
    if (!videoName) return;
    const { origW, origH, dispW, dispH } = imageDimsRef.current;
    if (!dispW || !dispH) {
      alert("Load a video first.");
      return;
    }

    setIsRunningYolo(true);
    pushHistory();

    try {
      const res = await axios.post(
        `http://localhost:8000/run-yolo/${videoName}`,
        { conf: yoloConf, match_thresh: matchThresh, max_lost: maxLost },
        { timeout: 0 }, // no timeout, bc inference can take a while
      );
      const { detections } = res.data;
      const scaleX = dispW / origW;
      const scaleY = dispH / origH;

      // merge new classes + assign colours
      const newClasses = [...classes];
      const newColors = { ...classColors };
      Object.values(detections)
        .flat()
        .forEach((d) => {
          if (!newClasses.includes(d.class_name)) {
            newClasses.push(d.class_name);
            newColors[d.class_name] =
              PALETTE[newClasses.length % PALETTE.length];
          }
        });

      // merge detected bboxes into existing annotations (non-destructive)
      setBboxesByFrame((prev) => {
        const next = {};

        for (const [frameIdx, bboxes] of Object.entries(prev)) {
          const manual = bboxes.filter((b) => b.confidence === undefined);
          if (manual.length > 0) next[frameIdx] = manual;
        }

        for (const [frameIdxStr, dets] of Object.entries(detections)) {
          const frameIdx = parseInt(frameIdxStr);
          const newBboxes = dets.map((d) => ({
            id: crypto.randomUUID(),
            className: d.class_name,
            x: d.xtl * scaleX,
            y: d.ytl * scaleY,
            width: (d.xbr - d.xtl) * scaleX,
            height: (d.ybr - d.ytl) * scaleY,
            confidence: d.confidence,
            trackId: d.track_id ?? null,
            tags: [],
          }));
          next[frameIdx] = [...(next[frameIdx] ?? []), ...newBboxes];
          // keeps manually added bboxes (with no conf level), and replaces yolo inferred ones
        }
        return next;
      });

      setClasses(newClasses);
      setClassColors(newColors);

      const total = Object.values(detections).reduce((s, d) => s + d.length, 0);
      alert(
        `Done: ${total} detections across ${Object.keys(detections).length} frames.`,
      );
    } catch (err) {
      console.error(err);
      alert("YOLO inference failed. Check the console.");
    } finally {
      setIsRunningYolo(false);
    }
  }

  // trigger re-extraction when quality changes
  async function changeQuality(newQuality) {
    if (!videoName || newQuality === quality) return;
    setQuality(newQuality);
    setIsExtracting(true);
    await axios.post(`http://localhost:8000/reextract/${videoName}`, {
      quality: QUALITY_PRESETS[newQuality],
    });
    setIsExtracting(false);
  }
  // autosave annotations, only autosave if new bboxes drawn
  useEffect(() => {
    if (!videoName) return;
    const interval = setInterval(() => {
      const current = JSON.stringify(bboxesByFrame);
      if (current === lastSavedRef.current) return; // nothing changed, skip
      saveSession(videoName, bboxesByFrame, classes, classColors).then(() => {
        lastSavedRef.current = JSON.stringify(bboxesByFrame);
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 5000);
      });
    }, 5000); // every 5 secs

    return () => clearInterval(interval);
  }, [videoName, bboxesByFrame, classes, classColors]);

  // frame navigation
  function prevFrame() {
    setCurrentFrame((f) => Math.max(0, f - 1));
  }

  function nextFrame() {
    setCurrentFrame((f) => Math.min(frameCount - 1, f + 1));
  }

  // keyboard controls
  useEffect(() => {
    if (!videoName) return;
    function handleKeyDown(e) {
      // ctrl shortcuts
      if (e.ctrlKey) {
        if (!["s", "z", "y", "c", "v", "a"].includes(e.key)) return;
        e.preventDefault();
        if (e.key === "s")
          saveSession(videoName, bboxesByFrame, classes, classColors).then(
            () => {
              lastSavedRef.current = JSON.stringify(bboxesByFrame);
              setShowSaved(true);
              setTimeout(() => setShowSaved(false), 5000);
            },
          );
        if (e.key === "z") undo();
        if (e.key === "y") redo();
        if (e.key === "c") copyBboxes();
        if (e.key === "v") pasteBboxes();
        if (e.key === "a") setSelectedBboxIds(frameBboxes.map((b) => b.id)); // ctrl+a to select all boxes
        return;
      }

      // other shortcuts
      if (e.key === "ArrowLeft") prevFrame(); // regular 1 frame skip
      if (e.key === "ArrowRight") nextFrame();
      if (e.key === ",") setCurrentFrame((f) => Math.max(0, f - frameInterval)); // keyframe interval skip
      if (e.key === ".")
        setCurrentFrame((f) => Math.min(frameCount - 1, f + frameInterval)); // mapped to unshifted < > keys
      if (e.key === " ") {
        e.preventDefault(); // to prevent spacebar from triggering file explorer directly after video upload
        setIsPlaying((p) => !p);
      }
      if (e.key === "w" || e.key === "W")
        setMode((m) => (m === "draw" ? "select" : "draw")); // toggle between select and draw mode
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedBboxIds.length > 0
      ) {
        // delete bbox if selected + hit backspace/del
        e.preventDefault();
        deleteBboxes(selectedBboxIds);
        setSelectedBboxIds([]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    videoName,
    frameCount,
    frameInterval,
    selectedBboxIds,
    frameBboxes,
    currentFrame,
    bboxesByFrame,
    classes,
    classColors,
  ]);

  // keep stateRef current
  useEffect(() => {
    stateRef.current = { bboxesByFrame, classes, classColors, tags };
  }, [bboxesByFrame, classes, classColors, tags]);

  // video playback
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentFrame((f) => {
          if (f >= frameCount - 1) {
            setIsPlaying(false);
            return f;
          }
          return f + 1;
        });
      }, 1000 / fps);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, frameCount]);

  // class label functions
  function addClass() {
    const trimmed = newClassName.trim();
    if (!trimmed || classes.includes(trimmed)) return;
    pushHistory();
    const color = PALETTE[classes.length % PALETTE.length];
    setClasses((c) => [...c, trimmed]);
    setClassColors((prev) => ({ ...prev, [trimmed]: color }));
    setNewClassName("");
  }

  function deleteClass(className) {
    pushHistory();
    setClasses((c) => c.filter((c) => c !== className));
    setClassColors((prev) => {
      const next = { ...prev };
      delete next[className];
      return next;
    });
    if (activeClass === className) setActiveClass(null);
  }

  // bbox drawing functions
  function addBbox(bbox) {
    pushHistory();
    setBboxesByFrame((prev) => ({
      ...prev,
      [currentFrame]: [...(prev[currentFrame] ?? []), { tags: [], ...bbox }],
    }));
  }

  function deleteBbox(id) {
    // used for delete button in context menu + right sidebar
    pushHistory();
    setBboxesByFrame((prev) => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).filter((b) => b.id !== id),
    }));
  }

  function deleteBboxes(ids) {
    // delete group of bboxes
    pushHistory();
    const idSet = new Set(ids);
    setBboxesByFrame((prev) => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).filter(
        (b) => !idSet.has(b.id),
      ),
    }));
  }

  function updateBboxes(updates) {
    // update group of bboxes
    pushHistory();
    setBboxesByFrame((prev) => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).map((b) => {
        const update = updates.find((u) => u.id === b.id);
        return update ? { ...b, ...update } : b;
      }),
    }));
  }

  // bbox class changing functions
  function changeClass(id, newClassName) {
    pushHistory();
    setBboxesByFrame((prev) => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).map((b) =>
        b.id === id ? { ...b, className: newClassName } : b,
      ),
    }));
  }

  function openContextMenu(x, y, bboxId) {
    setContextMenu({ x, y, bboxId });
  }

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      setContextMenu(null);
      setSelectedBboxIds([]);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // bbox tagging functions
  function addTag() {
    const trimmed = newTagName.trim();
    if (!trimmed || tags.includes(trimmed)) return; // ignore if 'new' tag already in list
    pushHistory();
    setTags((t) => [...t, trimmed]);
    setNewTagName("");
  }

  function deleteTag(tagName) {
    pushHistory();
    setTags((t) => t.filter((t) => t !== tagName));
    setBboxesByFrame((prev) => {
      // also remove it from any bbox that has it
      const next = {};
      for (const [frame, bboxes] of Object.entries(prev)) {
        next[frame] = bboxes.map((b) => ({
          ...b,
          tags: (b.tags ?? []).filter((t) => t !== tagName),
        }));
      }
      return next;
    });
  }

  function toggleBboxTag(bboxId, tagName) {
    pushHistory();
    setBboxesByFrame((prev) => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).map((b) => {
        if (b.id !== bboxId) return b;
        const has = (b.tags ?? []).includes(tagName);
        return {
          ...b,
          tags: has
            ? b.tags.filter((t) => t !== tagName) // remove tag if bbox already has it
            : [...(b.tags ?? []), tagName],
        }; // add tag if don't have yet
      }),
    }));
  }

  // undo, redo, copy, paste logic
  function pushHistory() {
    pastRef.current.push(JSON.parse(JSON.stringify(stateRef.current)));
    if (pastRef.current.length > 50) pastRef.current.shift(); // cap at 50
    futureRef.current = []; // clear redo stack on new action
  }

  function undo() {
    if (pastRef.current.length === 0) return;
    futureRef.current.unshift(JSON.parse(JSON.stringify(stateRef.current)));
    const snap = pastRef.current.pop();
    setBboxesByFrame(snap.bboxesByFrame);
    setClasses(snap.classes);
    setClassColors(snap.classColors);
    setTags(snap.tags);
  }

  function redo() {
    if (futureRef.current.length === 0) return;
    pastRef.current.push(JSON.parse(JSON.stringify(stateRef.current)));
    const snap = futureRef.current.shift();
    setBboxesByFrame(snap.bboxesByFrame);
    setClasses(snap.classes);
    setClassColors(snap.classColors);
    setTags(snap.tags);
  }

  function copyBboxes() {
    const selected = frameBboxes.filter((b) => selectedBboxIds.includes(b.id));
    if (selected.length === 0) return;
    clipboardRef.current = selected;
  }

  function pasteBboxes() {
    if (clipboardRef.current.length === 0) return;
    pushHistory();
    const newBboxes = clipboardRef.current.map((b) => ({
      ...b,
      id: crypto.randomUUID(),
      x: b.x + 10,
      y: b.y + 10,
    }));
    setBboxesByFrame((prev) => ({
      ...prev,
      [currentFrame]: [...(prev[currentFrame] ?? []), ...newBboxes],
    }));
    setSelectedBboxIds(newBboxes.map((b) => b.id));
  }

  // import CVAT .xml file
  function importXML(file) {
    if (!videoName) return;
    const { dispW, dispH } = imageDimsRef.current;
    if (!dispW || !dispH) {
      alert("Load the video first before importing.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const parser = new DOMParser();
      const xml = parser.parseFromString(e.target.result, "application/xml");

      const xmlOrigW = parseFloat(
        xml.querySelector("original_size > width")?.textContent,
      );
      const xmlOrigH = parseFloat(
        xml.querySelector("original_size > height")?.textContent,
      );
      if (!xmlOrigW || !xmlOrigH) {
        alert("Could not read original_size from XML.");
        return;
      }

      // scale from original image space to current display space
      const scaleX = dispW / xmlOrigW;
      const scaleY = dispH / xmlOrigH;

      const STANDARD_ATTRS = new Set([
        "frame",
        "keyframe",
        "outside",
        "xtl",
        "ytl",
        "xbr",
        "ybr",
        "z_order",
      ]);
      const importedBboxesByFrame = {};
      const importedClasses = [];
      const importedTags = new Set(tags);

      xml.querySelectorAll("track").forEach((track) => {
        const className = track.getAttribute("label");
        if (!importedClasses.includes(className))
          importedClasses.push(className);

        track.querySelectorAll("box").forEach((box) => {
          if (box.getAttribute("outside") === "1") return;

          const frame = parseInt(box.getAttribute("frame"));
          const xtl = parseFloat(box.getAttribute("xtl"));
          const ytl = parseFloat(box.getAttribute("ytl"));
          const xbr = parseFloat(box.getAttribute("xbr"));
          const ybr = parseFloat(box.getAttribute("ybr"));

          const x = xtl * scaleX;
          const y = ytl * scaleY;
          const width = (xbr - xtl) * scaleX;
          const height = (ybr - ytl) * scaleY;

          const boxTags = [];
          Array.from(box.attributes).forEach((attr) => {
            if (STANDARD_ATTRS.has(attr.name)) return;
            if (attr.value === "1") {
              boxTags.push(attr.name);
              importedTags.add(attr.name);
            }
          });

          if (!importedBboxesByFrame[frame]) importedBboxesByFrame[frame] = [];
          importedBboxesByFrame[frame].push({
            id: crypto.randomUUID(),
            className,
            x,
            y,
            width,
            height,
            tags: boxTags,
          });
        });
      });

      const mergedColors = { ...classColors };
      const mergedClasses = [...classes];
      importedClasses.forEach((cls) => {
        if (!mergedClasses.includes(cls)) {
          mergedClasses.push(cls);
          mergedColors[cls] = PALETTE[mergedClasses.length % PALETTE.length];
        }
      });

      setClasses(mergedClasses);
      setClassColors(mergedColors);
      setTags([...importedTags]);
      setBboxesByFrame(importedBboxesByFrame);
      pastRef.current = [];
      futureRef.current = [];
    };
    reader.readAsText(file);
  }

  // export final annotation functions
  function exportCVATXML() {
    const { origW, origH, dispW, dispH } = imageDimsRef.current;
    const scaleX = origW / dispW;
    const scaleY = origH / dispH;

    // CVAT timestamp format: "2026-05-22 02:31:39.107577+00:00"
    const formatDate = (date) =>
      date
        .toISOString()
        .replace("T", " ")
        .replace(/(\.\d{3})Z$/, "$1000+00:00");

    const now = formatDate(new Date());

    const labelsXml = classes
      .map(
        (cls) => `
        <label>
          <name>${cls}</name>
          <color>${classColors[cls] ?? "#ffffff"}</color>
          <type>any</type>
          <attributes>
          </attributes>
        </label>`,
      )
      .join("");

    let trackId = 0;
    const tracks = [];

    for (const [frameIndex, boxes] of Object.entries(bboxesByFrame)) {
      for (const box of boxes) {
        const xtl = (box.x * scaleX).toFixed(2);
        const ytl = (box.y * scaleY).toFixed(2);
        const xbr = ((box.x + box.width) * scaleX).toFixed(2);
        const ybr = ((box.y + box.height) * scaleY).toFixed(2);
        const nextFrame = parseInt(frameIndex) + 1;

        const boxTags = box.tags ?? [];
        const tagAttrs = tags
          .map((tag) => `${tag}="${boxTags.includes(tag) ? 1 : 0}"`)
          .join(" ");

        tracks.push(
          `  <track id="${trackId}" label="${box.className}" source="manual">\n` +
            `    <box frame="${frameIndex}" keyframe="1" outside="0" ${tagAttrs} xtl="${xtl}" ytl="${ytl}" xbr="${xbr}" ybr="${ybr}" z_order="0"> </box>\n` +
            `    <box frame="${nextFrame}" keyframe="1" outside="1" ${tagAttrs} xtl="${xtl}" ytl="${ytl}" xbr="${xbr}" ybr="${ybr}" z_order="0"> </box>\n` +
            `  </track>`,
        );
        trackId++;
      }
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
  <annotations>
    <version>1.1</version>
    <meta>
      <job>
        <id>1</id>
        <size>${frameCount}</size>
        <mode>interpolation</mode>
        <overlap>0</overlap>
        <bugtracker></bugtracker>
        <created>${now}</created>
        <updated>${now}</updated>
        <subset>default</subset>
        <start_frame>0</start_frame>
        <stop_frame>${frameCount - 1}</stop_frame>
        <frame_filter></frame_filter>
        <segments>
          <segment>
            <id>1</id>
            <start>0</start>
            <stop>${frameCount - 1}</stop>
            <url></url>
          </segment>
        </segments>
        <owner>
          <username></username>
          <email></email>
        </owner>
        <assignee></assignee>
        <labels>${labelsXml}
        </labels>
      </job>
      <dumped>${now}</dumped>
      <original_size>
        <width>${origW}</width>
        <height>${origH}</height>
      </original_size>
    </meta>
  ${tracks.join("\n")}
  </annotations>`;

    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${videoName}_annotations.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // open export stat video selector
  async function openStatsModal() {
    setIsLoadingProjects(true);
    setShowStatsModal(true);
    const res = await axios.get("http://localhost:8000/projects");
    setProjectsList(res.data);
    setSelectedProjects(
      videoName ? [videoName] : res.data.map((p) => p.video_name),
    ); // only select video that is open, by default
    setIsLoadingProjects(false);
  }

  async function openChipsModal() {
    setIsLoadingProjects(true);
    setShowChipsModal(true);
    const res = await axios.get("http://localhost:8000/projects");
    setProjectsList(res.data);
    setSelectedProjects(
      videoName ? [videoName] : res.data.map((p) => p.video_name),
    );
    setIsLoadingProjects(false);
  }

  // function to export stats of selected videos, into .csv format
  async function exportSelectedStats() {
    if (selectedProjects.length === 0) return;
    const res = await fetch("http://localhost:8000/stats/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_names: selectedProjects }),
    });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stats_export.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // function to select projects/videos
  function toggleProject(videoName) {
    setSelectedProjects((prev) =>
      prev.includes(videoName)
        ? prev.filter((n) => n !== videoName)
        : [...prev, videoName],
    );
  }

  // export target chips to data/chips
  async function exportChips() {
    if (selectedProjects.length === 0) return;
    setIsExportingChips(true);
    try {
      const res = await fetch("http://localhost:8000/chips/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_names: selectedProjects }),
      });
      const data = await res.json();
      alert(
        `Done: ${data.total_chips} chips exported${data.skipped_videos > 0 ? `, ${data.skipped_videos} videos skipped (missing dims)` : ""}.`,
      );
    } catch (err) {
      alert("Chip export failed. Check the console.");
      console.error(err);
    } finally {
      setIsExportingChips(false);
    }
  }

  // detect outliers in video
  async function scanOutliers() {
    if (!videoName) return;
    setIsScanning(true);
    try {
      const res = await fetch(`http://localhost:8000/outliers/${videoName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sigma: sigmaThresh,
          rare_pct: rarePctThresh,
          fps,
        }),
      });
      const data = await res.json();
      setOutliers(data.outliers);
    } catch (err) {
      console.error(err);
      alert("Outlier scan failed. Check the console.");
    } finally {
      setIsScanning(false);
    }
  }

  // UI block
  return (
    <div style={{ display: "flex", height: "100vh", textAlign: "center" }}>
      {/* left sidebar */}

      {/* class section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "20%",
          borderRight: "1px solid #ccc",
          padding: "8px",
        }}
      >
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <h3>Classes</h3>
          <p>Active class: {activeClass ?? "N/A"}</p>{" "}
          {/* shows selected class */}
          {/* new class input */}
          <input
            type="text"
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") addClass();
            }}
            placeholder="Enter new class"
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <button onClick={addClass}>Add</button>{" "}
          {/* button to add new class */}
          <ul>
            {/* class list & highlight (upon selection) */}
            {classes.map((className) => (
              <li
                key={className}
                onClick={() => setActiveClass(className)}
                style={{
                  fontWeight: activeClass === className ? "bold" : "normal",
                  backgroundColor:
                    activeClass === className ? "#750000" : "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  padding: "2px 4px",
                }}
              >
                <input
                  type="color"
                  value={classColors[className] ?? "#ffffff"}
                  onChange={(e) =>
                    setClassColors((prev) => ({
                      ...prev,
                      [className]: e.target.value,
                    }))
                  } // lets you pick which colour you want
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 20,
                    height: 20,
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                />
                {className}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteClass(className);
                  }}
                >
                  x
                </button>
              </li>
            ))}
          </ul>
        </div>
        {/* tag section */}
        <div
          style={{ borderTop: "1px solid #ccc", marginTop: 8, paddingTop: 8 }}
        >
          <h3>Tags</h3>
          {/* new tag input */}
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") addTag();
            }}
            placeholder="Add new tag"
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <button onClick={addTag}>Add</button>
          {/* tag list & application of tags on bbox */}
          {selectedBboxIds.length === 0 && (
            <p style={{ color: "#888", fontSize: 12 }}>
              Select a bbox to apply tags.
            </p>
          )}
          {selectedBboxIds.length > 1 && (
            <p style={{ color: "#888", fontSize: 12 }}>
              {selectedBboxIds.length} boxes selected.
            </p>
          )}

          <ul
            style={{ textAlign: "left", padding: "0 4px", listStyle: "none" }}
          >
            {tags.map((tag) => {
              const selectedBboxes = frameBboxes.filter((b) =>
                selectedBboxIds.includes(b.id),
              );
              const isChecked =
                selectedBboxes.length > 0 &&
                selectedBboxes.every((b) => (b.tags ?? []).includes(tag));
              return (
                <li
                  key={tag}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 0",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={selectedBboxIds.length === 0}
                    onChange={() =>
                      selectedBboxIds.forEach((id) => toggleBboxTag(id, tag))
                    }
                  />
                  <span
                    style={{
                      background: "#750000",
                      color: "#FFFFFF",
                      borderRadius: 3,
                      padding: "1px 5px",
                      fontSize: 11,
                    }}
                  >
                    {tag}
                  </span>
                  <button
                    onClick={() => deleteTag(tag)}
                    style={{ marginLeft: "auto" }}
                  >
                    x
                  </button>
                </li>
              );
            })}
          </ul>
          {/* model selection */}
          <div
            style={{
              borderTop: "1px solid #ccc",
              marginTop: 8,
              paddingTop: 8,
            }}
          >
            <h3>Models</h3>
            {/* confidence level slider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              <label style={{ fontSize: 11, width: 50, flexShrink: 0 }}>
                Conf: {yoloConf}
              </label>
              <input
                type="range"
                min={0.05}
                max={0.95}
                step={0.05}
                value={yoloConf}
                onChange={(e) => setYoloConf(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: "#750000", width: "100%" }}
              />
            </div>
            {/* match threshold slider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              <label style={{ fontSize: 11, width: 50, flexShrink: 0 }}>
                Match: {matchThresh}
              </label>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={matchThresh}
                onChange={(e) => setMatchThresh(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: "#750000", width: "100%" }}
              />
            </div>

            {/* max lost slider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              <label style={{ fontSize: 11, width: 50, flexShrink: 0 }}>
                Max lost: {maxLost}f
              </label>
              <input
                type="range"
                min={60}
                max={120}
                step={5}
                value={maxLost}
                onChange={(e) => setMaxLost(parseInt(e.target.value))}
                style={{ flex: 1, accentColor: "#750000", width: "100%" }}
              />
            </div>
            {/* run yolo button */}
            <button
              style={{ width: "100%" }}
              tabIndex={-1}
              disabled={!videoName || isRunningYolo || isExtracting}
              onClick={runYolo}
            >
              {isRunningYolo ? "Running…" : "Run YOLOv7-tiny"}
            </button>
            {/* run SAM button */}
            <button
              style={{ width: "100%", marginTop: 4, opacity: 0.4 }}
              tabIndex={-1}
              disabled
            >
              SAM (coming soon)
            </button>
          </div>
        </div>
      </div>

      {/* center area */}

      <div
        style={{
          flex: 1,
          padding: "2px 8px",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* video input button */}
              <input
                type="file"
                accept="video/*"
                id="video-input"
                style={{ display: "none" }}
                onChange={(e) => uploadVideo(e.target.files[0])}
              />
              <button
                tabIndex={-1}
                onClick={() => document.getElementById("video-input").click()}
              >
                Upload Video
              </button>
              {/* frame folder path input */}
              <div>
                <input
                  type="text"
                  placeholder="Absolute Path"
                  id="folder-path-input"
                  style={{ flex: "0 1 auto" }}
                  size="9"
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter")
                      loadFrameFolder(e.target.value.trim());
                  }}
                />
              </div>{" "}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "stretch",
                gap: 4,
              }}
            >
              {/* import .xml file */}
              <input
                type="file"
                accept=".xml"
                id="import-xml-input"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files[0]) importXML(e.target.files[0]);
                }}
              />
              <button
                style={{ width: "25%" }}
                tabIndex={-1}
                disabled={!videoName}
                onClick={() =>
                  document.getElementById("import-xml-input").click()
                }
              >
                Import XML
              </button>
              {/* export as .xml button */}
              <button
                style={{ width: "25%" }}
                tabIndex={-1}
                disabled={!videoName}
                onClick={exportCVATXML}
              >
                Export XML
              </button>
              <button
                tabIndex={-1}
                disabled={!videoName}
                onClick={openStatsModal}
                style={{ width: "25%" }}
              >
                Export Stats
              </button>
              <button
                tabIndex={-1}
                disabled={!videoName}
                onClick={openChipsModal}
                style={{ width: "25%" }}
              >
                Export Chips
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              {/* save button */}
              <button
                style={{ width: "100%" }}
                tabIndex={-1}
                disabled={!videoName}
                onClick={() =>
                  saveSession(
                    videoName,
                    bboxesByFrame,
                    classes,
                    classColors,
                  ).then(() => {
                    lastSavedRef.current = JSON.stringify(bboxesByFrame);
                    setShowSaved(true);
                    setTimeout(() => setShowSaved(false), 5000);
                  })
                }
              >
                Save
              </button>
            </div>
          </div>
          {/* saved indicator */}
          <span
            style={{
              fontSize: 12,
              color: "#009000",
              opacity: showSaved ? 1 : 0,
              transition: "opacity 0.5s ease",
              pointerEvents: "none",
            }}
          >
            ✓ Saved
          </span>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {/* mode toggle button */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <h4 style={{ margin: 0 }}> Mode Toggle (W)</h4>
              <button
                tabIndex={-1}
                onClick={() => setMode("select")}
                style={{
                  fontWeight: mode === "select" ? "bold" : "normal",
                  background: mode === "select" ? "#750000" : "",
                  color: mode === "select" ? "#fff" : "",
                  padding: "4px",
                }}
              >
                Select
              </button>
              <button
                tabIndex={-1}
                onClick={() => setMode("draw")}
                style={{
                  fontWeight: mode === "draw" ? "bold" : "normal",
                  background: mode === "draw" ? "#750000" : "",
                  color: mode === "draw" ? "#fff" : "",
                  padding: "4px",
                }}
              >
                Draw
              </button>
            </div>
            <div>
              {/* frame quality toggle */}
              {videoName && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 8,
                  }}
                >
                  <h4 style={{ margin: 0 }}>Quality</h4>
                  {["low", "medium", "high"].map((q) => (
                    <button
                      key={q}
                      tabIndex={-1}
                      disabled={isExtracting}
                      onClick={() => changeQuality(q)}
                      style={{
                        fontWeight: quality === q ? "bold" : "normal",
                        background: quality === q ? "#750000" : "",
                        color: quality === q ? "#fff" : "",
                        padding: "4px",
                      }}
                    >
                      {q.charAt(0).toUpperCase() + q.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* re-extraction message */}
            {isExtracting && (
              <p style={{ color: "#750000", margin: "0", fontSize: "16px" }}>
                Re-extracting frames, please wait...
              </p>
            )}
          </div>
        </div>

        {/* konva stage: image display */}
        {videoName && (
          <div style={{ width: "100%" }}>
            <p>
              Loaded: {videoName} ({frameCount} frames)
            </p>{" "}
            {/* shows total frame ct */}
            <AnnotationCanvas
              frameUrl={`http://localhost:8000/frame/${videoName}/${currentFrame}?q=${quality}`}
              activeClass={activeClass}
              classColors={classColors}
              frameBboxes={frameBboxes}
              addBbox={addBbox}
              selectedBboxIds={selectedBboxIds}
              setSelectedBboxIds={setSelectedBboxIds}
              openContextMenu={openContextMenu}
              mode={mode}
              updateBboxes={updateBboxes}
              onDimsReady={(dims) => {
                imageDimsRef.current = dims;
              }}
              outlierBboxIds={outliers.map((o) => o.bbox_id)}
            />{" "}
            {/* calls fastAPI for image */}
            <div>
              {/* playback navigation */}
              <button
                tabIndex={-1}
                onClick={() =>
                  setCurrentFrame((f) => Math.max(0, f - frameInterval))
                }
                disabled={currentFrame === 0 || isExtracting}
              >
                {"<<"}
              </button>{" "}
              {/* interval back */}
              <button
                tabIndex={-1}
                onClick={prevFrame}
                disabled={currentFrame === 0 || isExtracting}
              >
                {"<"}
              </button>{" "}
              {/* back button */}
              <span>
                {" "}
                Frame {currentFrame + 1} / {frameCount}{" "}
              </span>
              <button
                tabIndex={-1}
                onClick={nextFrame}
                disabled={currentFrame === frameCount - 1 || isExtracting}
              >
                {">"}
              </button>{" "}
              {/* forward button */}
              <button
                tabIndex={-1}
                onClick={() =>
                  setCurrentFrame((f) =>
                    Math.min(frameCount - 1, f + frameInterval),
                  )
                }
                disabled={currentFrame === frameCount - 1 || isExtracting}
              >
                {">>"}{" "}
              </button>{" "}
              {/* interval forward */}
            </div>
            <div>
              {/* frame interval setter */}
              <label>Interval: </label>
              <input
                type="number"
                value={frameInterval}
                min={1}
                onChange={(e) => setFrameInterval(Number(e.target.value))}
                style={{ width: "50px" }}
              />
              <span> frames</span>
            </div>
            {/* play/pause button */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                tabIndex={-1}
                onClick={() => setIsPlaying((p) => !p)}
                disabled={isExtracting}
              >
                {isPlaying ? "Pause" : "Play"}
                {/* video slider */}
              </button>
              {/* video slider with outlier markers */}
              <div style={{ flex: 1, position: "relative" }}>
                {/* outlier tick marks */}
                {outliers.map((o, i) => (
                  <div
                    key={i}
                    onClick={() => setCurrentFrame(o.frame_idx)}
                    style={{
                      position: "absolute",
                      left: `${(o.frame_idx / (frameCount - 1)) * 100}%`,
                      top: 0,
                      width: 3,
                      height: "100%",
                      background: OUTLIER_COLOR,
                      opacity: 0.8,
                      cursor: "pointer",
                      zIndex: 1,
                      transform: "translateX(-50%)",
                    }}
                    title={`${o.timestamp} — ${o.class} (${
                      o.reason === "orientation"
                        ? "⚠ wrong orientation"
                        : o.reason === "aspect_ratio"
                          ? "⚠ unusual shape"
                          : "⚠ rare class"
                    } — {o.detail})`}
                  />
                ))}
                <input
                  type="range"
                  min={0}
                  max={frameCount - 1}
                  value={currentFrame}
                  onChange={(e) => setCurrentFrame(Number(e.target.value))}
                  style={{
                    width: "100%",
                    accentColor: "#750000",
                    position: "relative",
                    zIndex: 2,
                  }}
                  disabled={isExtracting}
                />
              </div>
              <span>
                {formatTime(currentFrame / fps)} /{" "}
                {formatTime(frameCount / fps)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* right sidebar */}
      <div
        style={{
          width: "20%",
          borderLeft: "1px solid #ccc",
          padding: "8px",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflowY: "hidden",
        }}
      >
        {/* annotations list */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <h3 style={{ margin: 0 }}>Annotations</h3>
          {frameBboxes.length === 0 ? (
            <p style={{ color: "#aaa" }}>No annotations yet.</p>
          ) : (
            <ul style={{ textAlign: "left", padding: "0 16px", margin: 0 }}>
              {frameBboxes.map((b, i) => (
                <li
                  key={b.id}
                  title={b.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openContextMenu(e.clientX, e.clientY, b.id);
                  }}
                  style={{
                    background: outliers.some((o) => o.bbox_id === b.id)
                      ? `${OUTLIER_COLOR}22` // subtle highlight if flagged
                      : selectedBboxIds.includes(b.id)
                        ? "#333"
                        : "transparent",
                    border: outliers.some((o) => o.bbox_id === b.id)
                      ? `1px solid ${OUTLIER_COLOR}`
                      : "1px solid transparent",
                    borderRadius: 3,
                    marginBottom: 2,
                  }}
                >
                  {i + 1}. {b.className}{" "}
                  <span style={{ color: "#888", fontSize: 11 }}>
                    {b.trackId !== null && b.trackId !== undefined
                      ? `#${b.trackId}`
                      : `#${b.id.slice(0, 6)}`}
                  </span>
                  {outliers.some((o) => o.bbox_id === b.id) && (
                    <span
                      style={{
                        color: OUTLIER_COLOR,
                        fontSize: 10,
                        marginLeft: 4,
                      }}
                    >
                      ⚠
                    </span>
                  )}
                  {(b.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      style={{
                        background: "#750000",
                        color: "#FFFFFF",
                        borderRadius: 3,
                        padding: "1px 5px",
                        fontSize: 10,
                        marginLeft: 3,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                  <button
                    onClick={() => deleteBbox(b.id)}
                    style={{ marginLeft: 4 }}
                  >
                    x
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* outlier detection section */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
            borderTop: "1px solid #ccc",
            paddingTop: 8,
            width: "100%",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0" }}>Outlier Detection</h3>

          {/* sigma slider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 4,
            }}
          >
            <label
              style={{
                fontSize: 11,
                width: 50,
                flexShrink: 0,
              }}
            >
              σ thresh: {sigmaThresh.toFixed(1)}
            </label>
            <input
              type="range"
              min={1.5}
              max={3.0}
              step={0.1}
              value={sigmaThresh}
              onChange={(e) => setSigmaThresh(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: "#750000" }}
            />
          </div>

          {/* rare class slider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <label
              style={{
                fontSize: 11,
                width: 50,
                flexShrink: 0,
              }}
            >
              Rare: ≤{rarePctThresh.toFixed(1)}%
            </label>
            <input
              type="range"
              min={0.1}
              max={5.0}
              step={0.1}
              value={rarePctThresh}
              onChange={(e) => setRarePctThresh(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: "#750000" }}
            />
          </div>

          {/* scan button */}
          <button
            style={{ width: "100%", marginBottom: 8 }}
            tabIndex={-1}
            disabled={!videoName || isScanning}
            onClick={scanOutliers}
          >
            {isScanning ? "Scanning..." : `Scan for Outliers`}
          </button>

          {/* outlier list */}
          {outliers.length === 0 ? (
            <p style={{ color: "#888", fontSize: 11, margin: 0 }}>
              {isScanning ? "" : "No outliers detected."}
            </p>
          ) : (
            <>
              <p
                style={{
                  color: OUTLIER_COLOR,
                  fontSize: 11,
                  margin: "0 0 4px 0",
                }}
              >
                {outliers.length} outlier{outliers.length > 1 ? "s" : ""} found
              </p>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {outliers.map((o, i) => (
                  <li
                    key={i}
                    onClick={() => setCurrentFrame(o.frame_idx)}
                    style={{
                      cursor: "pointer",
                      padding: "4px 6px",
                      borderRadius: 3,
                      border: `1px solid ${OUTLIER_COLOR}44`,
                      background:
                        currentFrame === o.frame_idx
                          ? `${OUTLIER_COLOR}22`
                          : "transparent",
                      fontSize: 11,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = `${OUTLIER_COLOR}22`)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background =
                        currentFrame === o.frame_idx
                          ? `${OUTLIER_COLOR}22`
                          : "transparent")
                    }
                  >
                    <span style={{ color: OUTLIER_COLOR, fontWeight: "bold" }}>
                      {o.timestamp}
                    </span>{" "}
                    <span style={{ color: "#ccc" }}>{o.class}</span>
                    <div style={{ color: "#666", fontSize: 10 }}>
                      {o.reason === "orientation"
                        ? "⚠ wrong orientation"
                        : o.reason === "aspect_ratio"
                          ? "⚠ unusual shape"
                          : "⚠ rare class"}{" "}
                      — {o.detail}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      {/* context menu style */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "#1a1a1a",
            border: "1px solid #555",
            borderRadius: 4,
            zIndex: 1000,
            minWidth: 140,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          }}
          onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside menu
        >
          <div
            style={{
              padding: "4px 10px",
              color: "#888",
              fontSize: 11,
              borderBottom: "1px solid #333",
            }}
          >
            {" "}
            {/* context menu text color */}
            Change class:
          </div>
          {/* class change toggle */}
          {classes.map((cls) => (
            <div
              key={cls}
              onClick={() => {
                changeClass(contextMenu.bboxId, cls);
                setContextMenu(null);
              }}
              style={{
                padding: "6px 12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#333")} // color of background of mouse hover
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: classColors[cls] ?? "#fff",
                  display: "inline-block",
                }}
              />
              {cls}
            </div>
          ))}
          {/* tag toggle */}
          <div
            style={{
              borderTop: "1px solid #333",
              borderBottom: "1px solid #333",
            }}
          >
            <div style={{ padding: "4px 10px", color: "#888", fontSize: 11 }}>
              Tags:
            </div>
            {tags.map((tag) => {
              const bbox = frameBboxes.find((b) => b.id === contextMenu.bboxId);
              const isChecked = bbox ? (bbox.tags ?? []).includes(tag) : false;
              return (
                <div
                  key={tag}
                  onClick={() => toggleBboxTag(contextMenu.bboxId, tag)}
                  style={{
                    padding: "4px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#333")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    style={{ pointerEvents: "none" }}
                  />
                  {tag}
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: "1px solid #333" }}>
            {/* delete annotation button */}
            <div
              onClick={() => {
                deleteBbox(contextMenu.bboxId);
                setContextMenu(null);
              }}
              style={{
                padding: "6px 12px",
                cursor: "pointer",
                color: "#e74c3c",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#333")}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              Delete
            </div>
          </div>
        </div>
      )}
      {/* video selection for export to csv */}
      {showStatsModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={() => setShowStatsModal(false)}
        >
          <div
            style={{
              background: "#1a1a1a",
              border: "1px solid #555",
              borderRadius: 8,
              padding: 24,
              minWidth: 420,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0 }}>Export Stats</h3>
            {isLoadingProjects ? (
              <p style={{ color: "#888" }}>Loading projects...</p>
            ) : projectsList.length === 0 ? (
              <p style={{ color: "#888" }}>No saved projects found.</p>
            ) : (
              <>
                {/* select all toggle */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderBottom: "1px solid #333",
                    paddingBottom: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedProjects.length === projectsList.length}
                    onChange={() =>
                      setSelectedProjects(
                        selectedProjects.length === projectsList.length
                          ? []
                          : projectsList.map((p) => p.video_name),
                      )
                    }
                  />
                  <span style={{ fontWeight: "bold" }}>
                    Select all ({projectsList.length})
                  </span>
                </div>

                {/* video/project list */}
                <div
                  style={{
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {projectsList.map((p) => (
                    <label
                      key={p.video_name}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "6px 8px",
                        borderRadius: 4,
                        cursor: "pointer",
                        textAlign: "left",
                        background: selectedProjects.includes(p.video_name)
                          ? "#2a2a2a"
                          : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedProjects.includes(p.video_name)}
                        onChange={() => toggleProject(p.video_name)}
                        style={{ marginTop: 2 }}
                      />
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}
                      >
                        <span style={{ fontWeight: "bold", fontSize: 13 }}>
                          {p.video_name}
                        </span>
                        <span style={{ color: "#888", fontSize: 11 }}>
                          {p.bbox_count} bboxes · {p.class_count} classes ·{" "}
                          {p.frame_count} annotated frames
                        </span>
                        <span style={{ color: "#555", fontSize: 10 }}>
                          {p.classes.join(", ") || "no classes"}
                        </span>
                        <span style={{ color: "#444", fontSize: 10 }}>
                          Saved:{" "}
                          {p.saved_at !== "unknown"
                            ? new Date(p.saved_at).toLocaleString()
                            : "unknown"}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* footer */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                borderTop: "1px solid #333",
                paddingTop: 12,
              }}
            >
              <button tabIndex={-1} onClick={() => setShowStatsModal(false)}>
                Cancel
              </button>
              <button
                tabIndex={-1}
                disabled={selectedProjects.length === 0}
                onClick={async () => {
                  await exportSelectedStats();
                  setShowStatsModal(false);
                }}
                style={{
                  background: "#750000",
                  color: "#fff",
                  border: "none",
                  padding: "6px 16px",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Export{" "}
                {selectedProjects.length > 0
                  ? `(${selectedProjects.length})`
                  : ""}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* video selection for chip export */}
      {showChipsModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={() => setShowChipsModal(false)}
        >
          <div
            style={{
              background: "#1a1a1a",
              border: "1px solid #555",
              borderRadius: 8,
              padding: 24,
              minWidth: 420,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0 }}>Export Chips</h3>
            {isLoadingProjects ? (
              <p style={{ color: "#888" }}>Loading projects...</p>
            ) : projectsList.length === 0 ? (
              <p style={{ color: "#888" }}>No saved projects found.</p>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderBottom: "1px solid #333",
                    paddingBottom: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedProjects.length === projectsList.length}
                    onChange={() =>
                      setSelectedProjects(
                        selectedProjects.length === projectsList.length
                          ? []
                          : projectsList.map((p) => p.video_name),
                      )
                    }
                  />
                  <span style={{ fontWeight: "bold" }}>
                    Select all ({projectsList.length})
                  </span>
                </div>
                <div
                  style={{
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {projectsList.map((p) => (
                    <label
                      key={p.video_name}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "6px 8px",
                        borderRadius: 4,
                        cursor: "pointer",
                        textAlign: "left",
                        background: selectedProjects.includes(p.video_name)
                          ? "#2a2a2a"
                          : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedProjects.includes(p.video_name)}
                        onChange={() => toggleProject(p.video_name)}
                        style={{ marginTop: 2 }}
                      />
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}
                      >
                        <span style={{ fontWeight: "bold", fontSize: 13 }}>
                          {p.video_name}
                        </span>
                        <span style={{ color: "#888", fontSize: 11 }}>
                          {p.bbox_count} bboxes · {p.class_count} classes ·{" "}
                          {p.frame_count} annotated frames
                        </span>
                        <span style={{ color: "#555", fontSize: 10 }}>
                          {p.classes.join(", ") || "no classes"}
                        </span>
                        <span style={{ color: "#444", fontSize: 10 }}>
                          Saved:{" "}
                          {p.saved_at !== "unknown"
                            ? new Date(p.saved_at).toLocaleString()
                            : "unknown"}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 8,
                borderTop: "1px solid #333",
                paddingTop: 12,
              }}
            >
              {isExportingChips && (
                <span style={{ fontSize: 12, color: "#888" }}>
                  Exporting chips, please wait...
                </span>
              )}
              <button
                tabIndex={-1}
                onClick={() => setShowChipsModal(false)}
                disabled={isExportingChips}
              >
                Cancel
              </button>
              <button
                tabIndex={-1}
                disabled={selectedProjects.length === 0 || isExportingChips}
                onClick={async () => {
                  await exportChips();
                  setShowChipsModal(false);
                }}
                style={{
                  background: "#750000",
                  color: "#fff",
                  border: "none",
                  padding: "6px 16px",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                {isExportingChips
                  ? "Exporting..."
                  : `Export (${selectedProjects.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
