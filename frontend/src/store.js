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

  // shortcut (ctrl z,y,c,v) states kept as refs in App.jsx (not reactive state)

  // model states
  yoloConf: 0.25, // confidence level, default is 0.25
  isRunningYolo: false,
  isPropagating: false, // csrt box propagation in progress
  isMarkingFa: false, // csrt fa track-marking in progress
  faMatchClass: true, // fa track only tags same-class boxes; toggle off for label-flickering FAs (car/van/truck)
  matchThresh: 0.5, // bytetrack settings
  maxLost: 90,

  // outlier detection states
  outliers: [],
  isScanning: false,
  embPctThresh: 4.0, // sensitivity k: flag NN distances this many MADs above the class median (higher = stricter)
  rarePctThresh: 1.0,

  // embedding states (shared by outlier detection rule 3 and bytetrack re-id)
  embeddingStatus: "idle", // idle/computing/ready, for sidebar indicator

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
      embeddingStatus: "idle", // new video, old embedding cache no longer valid
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
        // restore embedding status if cache already exists for this video
        const embRes = await fetch(
          `http://localhost:8000/embeddings-status/${res.data.video_name}`,
        );
        const embData = await embRes.json();
        if (embData.status === "ready") set({ embeddingStatus: "ready" });
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
        embeddingStatus: "idle", // new video, old embedding cache no longer valid
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
          // restore embedding status if cache already exists for this video
          const embRes = await fetch(
            `http://localhost:8000/embeddings-status/${res.data.video_name}`,
          );
          const embData = await embRes.json();
          if (embData.status === "ready") set({ embeddingStatus: "ready" });
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

  // propagate a single selected box forward with csrt
  propagateBox: async (bboxId, opts = {}) => {
    const {
      videoName,
      currentFrame,
      bboxesByFrame,
      imageDims,
      tags,
      pushHistory,
    } = get();
    if (!videoName) return;

    const frameBboxes = bboxesByFrame[currentFrame] ?? [];
    const src = frameBboxes.find((b) => b.id === bboxId);
    if (!src) {
      alert("Select a box on this frame to propagate.");
      return;
    }

    const { origW, origH, dispW, dispH } = imageDims;
    if (!origW || !dispW) {
      alert("Load a video first.");
      return;
    }
    const scaleX = dispW / origW;
    const scaleY = dispH / origH;

    set({ isPropagating: true });
    try {
      const res = await fetch(`http://localhost:8000/propagate/${videoName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_frame: currentFrame,
          // scale the seed box UP into original pixel space for csrt
          box: {
            x: src.x / scaleX,
            y: src.y / scaleY,
            width: src.width / scaleX,
            height: src.height / scaleY,
          },
        }),
      });
      const data = await res.json();
      if (data.error) {
        alert(`Propagation failed: ${data.error}`);
        return;
      }

      const boxes = data.boxes ?? {};
      const frameIdxs = Object.keys(boxes);
      if (frameIdxs.length === 0) {
        alert(
          `Propagation stopped immediately (${data.stop_reason}). Nothing to add.`,
        );
        return;
      }

      // make sure the "propagated" tag exists so the sidebar/label render it
      const PROP_TAG = "propagated";
      const nextTags = tags.includes(PROP_TAG) ? tags : [...tags, PROP_TAG];

      pushHistory();
      // scale each returned box back DOWN into display space + write across frames
      const next = { ...bboxesByFrame };
      for (const [frameIdxStr, b] of Object.entries(boxes)) {
        const frameIdx = parseInt(frameIdxStr);
        const newBox = {
          id: crypto.randomUUID(),
          className: src.className,
          x: b.x * scaleX,
          y: b.y * scaleY,
          width: b.width * scaleX,
          height: b.height * scaleY,
          tags: [PROP_TAG],
          // no conf field, to indicate that bbox is drawn manually vs detected by yolo
        };
        next[frameIdx] = [...(next[frameIdx] ?? []), newBox];
      }

      set({ bboxesByFrame: next, tags: nextTags });
      alert(
        `Propagated ${data.count} frame${data.count === 1 ? "" : "s"} (stopped: ${data.stop_reason}).`,
      );
    } catch (err) {
      console.error(err);
      alert("Propagation failed. Check the console.");
    } finally {
      set({ isPropagating: false });
    }
  },

  // function to mark a moving FA across frames
  markFaTrack: async (bboxId, opts = {}) => {
    const {
      videoName,
      currentFrame,
      bboxesByFrame,
      imageDims,
      tags,
      faMatchClass,
      pushHistory,
    } = get();
    if (!videoName) return;

    const frameBboxes = bboxesByFrame[currentFrame] ?? [];
    const src = frameBboxes.find((b) => b.id === bboxId);
    if (!src) {
      alert("Select a box on this frame to mark as FA.");
      return;
    }

    const { origW, origH, dispW, dispH } = imageDims;
    if (!origW || !dispW) {
      alert("Load a video first.");
      return;
    }
    const scaleX = dispW / origW;
    const scaleY = dispH / origH;

    // match_class on by default, only tags same class bboxes
    const matchClass = opts.matchClass ?? faMatchClass;

    const existing = {};
    for (const [frameIdxStr, boxes] of Object.entries(bboxesByFrame)) {
      if (parseInt(frameIdxStr) <= currentFrame) continue;
      existing[frameIdxStr] = boxes.map((b) => ({
        id: b.id,
        className: b.className,
        x: b.x / scaleX,
        y: b.y / scaleY,
        width: b.width / scaleX,
        height: b.height / scaleY,
      }));
    }

    set({ isMarkingFa: true });
    try {
      const res = await fetch(
        `http://localhost:8000/mark-fa-track/${videoName}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start_frame: currentFrame,
            // scale the seed box up into original pixel space for csrt
            box: {
              x: src.x / scaleX,
              y: src.y / scaleY,
              width: src.width / scaleX,
              height: src.height / scaleY,
            },
            existing,
            fa_class: src.className, // only tag same-class boxes when match_class is on
            match_class: matchClass,
          }),
        },
      );
      const data = await res.json();
      if (data.error) {
        alert(`FA marking failed: ${data.error}`);
        return;
      }

      const matchedIds = data.matched_ids ?? [];

      // make sure the "false-alarm" tag exists, in case it was deleted
      const FA_TAG = "false-alarm";
      const nextTags = tags.includes(FA_TAG) ? tags : [...tags, FA_TAG];

      pushHistory();
      // tag the seed box + every matched existing box as fa (across all frames)
      const toTag = new Set([src.id, ...matchedIds]);
      const next = {};
      for (const [frameIdxStr, boxes] of Object.entries(bboxesByFrame)) {
        next[frameIdxStr] = boxes.map((b) => {
          if (!toTag.has(b.id)) return b;
          const has = (b.tags ?? []).includes(FA_TAG);
          return has ? b : { ...b, tags: [...(b.tags ?? []), FA_TAG] };
        });
      }

      set({ bboxesByFrame: next, tags: nextTags });
      alert(
        `Marked ${matchedIds.length} box${matchedIds.length === 1 ? "" : "es"} as FA (stopped: ${data.stop_reason}).`,
      );
    } catch (err) {
      console.error(err);
      alert("FA marking failed. Check the console.");
    } finally {
      set({ isMarkingFa: false });
    }
  },

  // delete every box tagged "false-alarm" across all frames
  removeAllFa: () => {
    const { bboxesByFrame, pushHistory } = get();
    const FA_TAG = "false-alarm";

    // skip the case where no boxes are tagged FA
    let count = 0;
    for (const boxes of Object.values(bboxesByFrame)) {
      count += boxes.filter((b) => (b.tags ?? []).includes(FA_TAG)).length;
    }
    if (count === 0) {
      alert("No boxes are tagged FA.");
      return;
    }
    if (
      !window.confirm(
        `Delete ${count} box${count === 1 ? "" : "es"} tagged FA?`,
      )
    )
      return;

    pushHistory();
    const next = {};
    for (const [frameIdxStr, boxes] of Object.entries(bboxesByFrame)) {
      next[frameIdxStr] = boxes.filter((b) => !(b.tags ?? []).includes(FA_TAG));
    }
    set({ bboxesByFrame: next });
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

  // compute osnet embeddings for all annotated bboxes, cache to data/output/video-name/embeddings.json
  computeEmbeddings: async (force = false) => {
    // force=true to recompute even if cache exists (e.g. after re-annotating)
    const { videoName } = get();
    if (!videoName) return;
    set({ embeddingStatus: "computing" });
    try {
      const res = await fetch(`http://localhost:8000/embeddings/${videoName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (data.error) {
        alert(`Embedding failed: ${data.error}`); // surface backend error (e.g. no annotations saved yet)
        set({ embeddingStatus: "idle" });
        return;
      }
      set({ embeddingStatus: "ready" });
    } catch (err) {
      console.error(err);
      alert("Embedding computation failed. Check the console.");
      set({ embeddingStatus: "idle" });
    }
  },

  // run bytetrack with visual re-id using precomputed embeddings
  // separate from runYolo so yolo inference stays fast (no embeddings on first run)
  runTrackingWithReId: async () => {
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
    set({ isRunningYolo: true }); // reuse yolo loading state since it blocks the same UI
    pushHistory();
    try {
      const res = await axios.post(
        `http://localhost:8000/run-yolo/${videoName}`,
        {
          conf: yoloConf,
          match_thresh: matchThresh,
          max_lost: maxLost,
          use_embeddings: true,
        },
        { timeout: 0 },
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
        `Re-ID done: ${total} detections re-tracked with visual embeddings.`,
      );
    } catch (err) {
      console.error(err);
      alert("Re-ID tracking failed. Check the console.");
    } finally {
      set({ isRunningYolo: false });
    }
  },

  // detect outliers in video
  scanOutliers: async () => {
    const { videoName, embPctThresh, rarePctThresh, fps } = get();
    if (!videoName) return;
    set({ isScanning: true });
    try {
      const res = await fetch(`http://localhost:8000/outliers/${videoName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emb_k: embPctThresh, // sensitivity: MADs above class-median NN distance
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
