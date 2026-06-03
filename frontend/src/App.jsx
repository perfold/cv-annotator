import { useEffect, useState, useRef } from "react";
import axios from "axios";
import AnnotationCanvas from "./components/AnnotationCanvas";
import LeftSidebar from "./components/LeftSidebar";
import Toolbar from "./components/Toolbar";
import VideoScrubber from "./components/VideoScrubber";
import RightSidebar from "./components/RightSidebar";
import ContextMenu from "./components/ContextMenu";
import ProjectModal from "./components/ProjectModal";
import { PALETTE, DEFAULT_TAGS, QUALITY_PRESETS } from "./constants";

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
      <LeftSidebar
        activeClass={activeClass}
        setActiveClass={setActiveClass}
        newClassName={newClassName}
        setNewClassName={setNewClassName}
        addClass={addClass}
        classes={classes}
        classColors={classColors}
        setClassColors={setClassColors}
        deleteClass={deleteClass}
        newTagName={newTagName}
        setNewTagName={setNewTagName}
        addTag={addTag}
        tags={tags}
        selectedBboxIds={selectedBboxIds}
        frameBboxes={frameBboxes}
        toggleBboxTag={toggleBboxTag}
        deleteTag={deleteTag}
        yoloConf={yoloConf}
        setYoloConf={setYoloConf}
        matchThresh={matchThresh}
        setMatchThresh={setMatchThresh}
        maxLost={maxLost}
        setMaxLost={setMaxLost}
        videoName={videoName}
        isRunningYolo={isRunningYolo}
        isExtracting={isExtracting}
        runYolo={runYolo}
      />

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
        <Toolbar
          videoName={videoName}
          uploadVideo={uploadVideo}
          loadFrameFolder={loadFrameFolder}
          importXML={importXML}
          exportCVATXML={exportCVATXML}
          openStatsModal={openStatsModal}
          openChipsModal={openChipsModal}
          saveSession={saveSession}
          bboxesByFrame={bboxesByFrame}
          classes={classes}
          classColors={classColors}
          lastSavedRef={lastSavedRef}
          setShowSaved={setShowSaved}
          showSaved={showSaved}
          mode={mode}
          setMode={setMode}
          quality={quality}
          changeQuality={changeQuality}
          isExtracting={isExtracting}
        />

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
            <VideoScrubber
              currentFrame={currentFrame}
              frameCount={frameCount}
              frameInterval={frameInterval}
              setFrameInterval={setFrameInterval}
              setCurrentFrame={setCurrentFrame}
              prevFrame={prevFrame}
              nextFrame={nextFrame}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              isExtracting={isExtracting}
              fps={fps}
              outliers={outliers}
              OUTLIER_COLOR={OUTLIER_COLOR}
              formatTime={formatTime}
            />
          </div>
        )}
      </div>

      <RightSidebar
        frameBboxes={frameBboxes}
        selectedBboxIds={selectedBboxIds}
        outliers={outliers}
        OUTLIER_COLOR={OUTLIER_COLOR}
        currentFrame={currentFrame}
        setCurrentFrame={setCurrentFrame}
        openContextMenu={openContextMenu}
        deleteBbox={deleteBbox}
        sigmaThresh={sigmaThresh}
        setSigmaThresh={setSigmaThresh}
        rarePctThresh={rarePctThresh}
        setRarePctThresh={setRarePctThresh}
        videoName={videoName}
        isScanning={isScanning}
        scanOutliers={scanOutliers}
      />

      <ContextMenu
        contextMenu={contextMenu}
        classes={classes}
        classColors={classColors}
        tags={tags}
        frameBboxes={frameBboxes}
        changeClass={changeClass}
        toggleBboxTag={toggleBboxTag}
        deleteBbox={deleteBbox}
        setContextMenu={setContextMenu}
      />

      {/* video selection for export to csv */}
      <ProjectModal
        show={showStatsModal}
        setShow={setShowStatsModal}
        mode="stats"
        isLoadingProjects={isLoadingProjects}
        projectsList={projectsList}
        selectedProjects={selectedProjects}
        setSelectedProjects={setSelectedProjects}
        toggleProject={toggleProject}
        exportSelectedStats={exportSelectedStats}
      />

      {/* video selection for chip export */}
      <ProjectModal
        show={showChipsModal}
        setShow={setShowChipsModal}
        mode="chips"
        isLoadingProjects={isLoadingProjects}
        projectsList={projectsList}
        selectedProjects={selectedProjects}
        setSelectedProjects={setSelectedProjects}
        toggleProject={toggleProject}
        exportChips={exportChips}
        isExportingChips={isExportingChips}
      />
    </div>
  );
}

export default App;
