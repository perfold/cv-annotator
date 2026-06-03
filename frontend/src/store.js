import { create } from "zustand";
import axios from "axios";
import { PALETTE, DEFAULT_TAGS, QUALITY_PRESETS } from "./constants";

const useStore = create((set, get) => ({
  // video states
  videoName: null,
  frameCount: null,
  currentFrame: 0,
  fps: 30,
  isPlaying: false,
  frameInterval: 10, // user definable keyframe interval, 10 is default

  // export stats states
  showStatsModal: false,
  showChipsModal: false,
  projectsList: [],
  selectedProjects: [],
  isLoadingProjects: false,
  isExportingChips: false,

  // select/draw mode
  mode: "select", // toggle between select and draw mode
  showSaved: false,
  imageDims: { origW: 0, origH: 0, dispW: 0, dispH: 0 }, // export .xml

  // switch quality toggle
  quality: "low", // set quality of extracted frames, default low
  isExtracting: false,

  // class labels
  classes: [], // list of existing classes
  newClassName: "", // temporary, to hold half-typed labels
  activeClass: null, // currently selected class
  classColors: {}, // custom colors for the classes

  // bbox states
  bboxesByFrame: {}, // stores dict of frame:list of bbox
  selectedBboxIds: [], // handles tracking of selected bboxes, to change classes/drag
  contextMenu: null, // where to render floating menu, and for which bbox

  // bbox tags
  tags: DEFAULT_TAGS,
  newTagName: "", // used to add custom tags for the bboxes

  // shortcut (ctrl z,y,c,v) states — kept as refs in App.jsx (not reactive state)

  // model states
  yoloConf: 0.25, // confidence level, default is 0.25
  isRunningYolo: false,
  matchThresh: 0.5, // bytetrack settings
  maxLost: 90,

  // outlier detection states
  outliers: [],
  isScanning: false,
  sigmaThresh: 2.0,
  rarePctThresh: 1.0,

  // save and load annotations from data folder
  saveSession: async () => {
    const { videoName, bboxesByFrame, classes, classColors, imageDims } = get();
    const { origW, origH, dispW, dispH } = imageDims;
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
  },

  loadSession: async (videoName) => {
    const res = await axios.get(`http://localhost:8000/load/${videoName}`);
    return Object.keys(res.data).length > 0 ? res.data : null;
  },

  // upload video function
  uploadVideo: async (file) => {
    const { quality, loadSession } = get();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("quality", QUALITY_PRESETS[quality]);

    const res = await axios.post(
      "http://localhost:8000/upload-video",
      formData,
    );
    set({
      videoName: res.data.video_name,
      frameCount: res.data.frame_count,
      fps: res.data.frame_rate,
      currentFrame: 0,
      bboxesByFrame: {},
      outliers: [],
    });

    // resume annotations
    const session = await loadSession(res.data.video_name);
    if (session) {
      const resume = window.confirm(
        `Resume previous session?\nLast saved: ${new Date(session.savedAt).toLocaleString()}`,
      );
      if (resume) {
        set({
          bboxesByFrame: session.bboxesByFrame,
          classes: session.classes,
          classColors: session.classColors ?? {},
        });
      }
    }
  },

  // load frames from folder
  loadFrameFolder: async (folderPath) => {
    if (!folderPath) return;
    const { loadSession } = get();
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
      set({
        videoName: res.data.video_name,
        frameCount: res.data.frame_count,
        fps: res.data.frame_rate,
        currentFrame: 0,
        bboxesByFrame: {},
        outliers: [],
      });
      const session = await loadSession(res.data.video_name);
      if (session) {
        const resume = window.confirm(
          `Resume previous session?\nLast saved: ${new Date(session.savedAt).toLocaleString()}`,
        );
        if (resume) {
          set({
            bboxesByFrame: session.bboxesByFrame,
            classes: session.classes,
            classColors: session.classColors ?? {},
          });
        }
      }
    } catch (err) {
      alert("Failed to load folder: " + err.message);
    }
  },

  // run yolo on all frames
  runYolo: async () => {
    const {
      videoName,
      imageDims,
      yoloConf,
      matchThresh,
      maxLost,
      classes,
      classColors,
      pushHistory,
    } = get();
    if (!videoName) return;
    const { origW, origH, dispW, dispH } = imageDims;
    if (!dispW || !dispH) {
      alert("Load a video first.");
      return;
    }

    set({ isRunningYolo: true });
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
      const prev = get().bboxesByFrame;
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

      set({ bboxesByFrame: next, classes: newClasses, classColors: newColors });

      const total = Object.values(detections).reduce((s, d) => s + d.length, 0);
      alert(
        `Done: ${total} detections across ${Object.keys(detections).length} frames.`,
      );
    } catch (err) {
      console.error(err);
      alert("YOLO inference failed. Check the console.");
    } finally {
      set({ isRunningYolo: false });
    }
  },

  // trigger re-extraction when quality changes
  changeQuality: async (newQuality) => {
    const { videoName, quality } = get();
    if (!videoName || newQuality === quality) return;
    set({ quality: newQuality, isExtracting: true });
    await axios.post(`http://localhost:8000/reextract/${videoName}`, {
      quality: QUALITY_PRESETS[newQuality],
    });
    set({ isExtracting: false });
  },

  // frame nav
  prevFrame: () => {
    set((s) => ({ currentFrame: Math.max(0, s.currentFrame - 1) }));
  },

  nextFrame: () => {
    set((s) => ({
      currentFrame: Math.min(s.frameCount - 1, s.currentFrame + 1),
    }));
  },

  // context menu
  openContextMenu: (x, y, bboxId) => {
    set({ contextMenu: { x, y, bboxId } });
  },

  // classes

  addClass: () => {
    const { newClassName, classes, classColors, pushHistory } = get();
    const trimmed = newClassName.trim();
    if (!trimmed || classes.includes(trimmed)) return;
    pushHistory();
    const color = PALETTE[classes.length % PALETTE.length];
    set({
      classes: [...classes, trimmed],
      classColors: { ...classColors, [trimmed]: color },
      newClassName: "",
    });
  },

  deleteClass: (className) => {
    const { classes, classColors, activeClass, pushHistory } = get();
    pushHistory();
    const next = { ...classColors };
    delete next[className];
    set({
      classes: classes.filter((c) => c !== className),
      classColors: next,
      activeClass: activeClass === className ? null : activeClass,
    });
  },

  // bbox drawing

  addBbox: (bbox) => {
    const { currentFrame, bboxesByFrame, pushHistory } = get();
    pushHistory();
    set({
      bboxesByFrame: {
        ...bboxesByFrame,
        [currentFrame]: [
          ...(bboxesByFrame[currentFrame] ?? []),
          { tags: [], ...bbox },
        ],
      },
    });
  },

  // used for delete button in context menu + right sidebar
  deleteBbox: (id) => {
    const { currentFrame, bboxesByFrame, pushHistory } = get();
    pushHistory();
    set({
      bboxesByFrame: {
        ...bboxesByFrame,
        [currentFrame]: (bboxesByFrame[currentFrame] ?? []).filter(
          (b) => b.id !== id,
        ),
      },
    });
  },

  // delete group of bboxes
  deleteBboxes: (ids) => {
    const { currentFrame, bboxesByFrame, pushHistory } = get();
    pushHistory();
    const idSet = new Set(ids);
    set({
      bboxesByFrame: {
        ...bboxesByFrame,
        [currentFrame]: (bboxesByFrame[currentFrame] ?? []).filter(
          (b) => !idSet.has(b.id),
        ),
      },
    });
  },

  // update group of bboxes
  updateBboxes: (updates) => {
    const { currentFrame, bboxesByFrame, pushHistory } = get();
    pushHistory();
    set({
      bboxesByFrame: {
        ...bboxesByFrame,
        [currentFrame]: (bboxesByFrame[currentFrame] ?? []).map((b) => {
          const update = updates.find((u) => u.id === b.id);
          return update ? { ...b, ...update } : b;
        }),
      },
    });
  },

  // bbox class changing functions
  changeClass: (id, newClassName) => {
    const { currentFrame, bboxesByFrame, pushHistory } = get();
    pushHistory();
    set({
      bboxesByFrame: {
        ...bboxesByFrame,
        [currentFrame]: (bboxesByFrame[currentFrame] ?? []).map((b) =>
          b.id === id ? { ...b, className: newClassName } : b,
        ),
      },
    });
  },

  // tagging functions
  addTag: () => {
    const { newTagName, tags, pushHistory } = get();
    const trimmed = newTagName.trim();
    if (!trimmed || tags.includes(trimmed)) return; // ignore if 'new' tag already in list
    pushHistory();
    set({ tags: [...tags, trimmed], newTagName: "" });
  },

  deleteTag: (tagName) => {
    const { tags, bboxesByFrame, pushHistory } = get();
    pushHistory();
    // also remove it from any bbox that has it
    const next = {};
    for (const [frame, bboxes] of Object.entries(bboxesByFrame)) {
      next[frame] = bboxes.map((b) => ({
        ...b,
        tags: (b.tags ?? []).filter((t) => t !== tagName),
      }));
    }
    set({ tags: tags.filter((t) => t !== tagName), bboxesByFrame: next });
  },

  toggleBboxTag: (bboxId, tagName) => {
    const { currentFrame, bboxesByFrame, pushHistory } = get();
    pushHistory();
    set({
      bboxesByFrame: {
        ...bboxesByFrame,
        [currentFrame]: (bboxesByFrame[currentFrame] ?? []).map((b) => {
          if (b.id !== bboxId) return b;
          const has = (b.tags ?? []).includes(tagName);
          return {
            ...b,
            tags: has
              ? b.tags.filter((t) => t !== tagName) // remove tag if bbox already has it
              : [...(b.tags ?? []), tagName],
          }; // add tag if don't have yet
        }),
      },
    });
  },

  // import CVAT .xml file
  importXML: (file) => {
    const { videoName, imageDims, tags, classes, classColors } = get();
    if (!videoName) return;
    const { dispW, dispH } = imageDims;
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

      set({
        classes: mergedClasses,
        classColors: mergedColors,
        tags: [...importedTags],
        bboxesByFrame: importedBboxesByFrame,
      });
    };
    reader.readAsText(file);
  },

  // export final annotation functions
  exportCVATXML: () => {
    const {
      videoName,
      frameCount,
      bboxesByFrame,
      classes,
      classColors,
      tags,
      imageDims,
    } = get();
    const { origW, origH, dispW, dispH } = imageDims;
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
  },

  // open export stat video selector
  openStatsModal: async () => {
    const { videoName } = get();
    set({ isLoadingProjects: true, showStatsModal: true });
    const res = await axios.get("http://localhost:8000/projects");
    set({
      projectsList: res.data,
      selectedProjects: videoName
        ? [videoName]
        : res.data.map((p) => p.video_name), // only select video that is open, by default
      isLoadingProjects: false,
    });
  },

  // export target chip selector
  openChipsModal: async () => {
    const { videoName } = get();
    set({ isLoadingProjects: true, showChipsModal: true });
    const res = await axios.get("http://localhost:8000/projects");
    set({
      projectsList: res.data,
      selectedProjects: videoName
        ? [videoName]
        : res.data.map((p) => p.video_name),
      isLoadingProjects: false,
    });
  },

  // function to select projects/videos
  toggleProject: (name) => {
    const { selectedProjects } = get();
    set({
      selectedProjects: selectedProjects.includes(name)
        ? selectedProjects.filter((n) => n !== name)
        : [...selectedProjects, name],
    });
  },

  // function to export stats of selected videos, into .csv format
  exportSelectedStats: async () => {
    const { selectedProjects } = get();
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
  },

  // export target chips to data/chips
  exportChips: async () => {
    const { selectedProjects } = get();
    if (selectedProjects.length === 0) return;
    set({ isExportingChips: true });
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
      set({ isExportingChips: false });
    }
  },

  // detect outliers in video
  scanOutliers: async () => {
    const { videoName, sigmaThresh, rarePctThresh, fps } = get();
    if (!videoName) return;
    set({ isScanning: true });
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
      set({ outliers: data.outliers });
    } catch (err) {
      console.error(err);
      alert("Outlier scan failed. Check the console.");
    } finally {
      set({ isScanning: false });
    }
  },
}));

export default useStore;
