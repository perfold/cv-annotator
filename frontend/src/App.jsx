import { useEffect, useRef } from "react";
import useStore from "./store";
import AnnotationCanvas from "./components/AnnotationCanvas";
import LeftSidebar from "./components/LeftSidebar";
import Toolbar from "./components/Toolbar";
import VideoScrubber from "./components/VideoScrubber";
import RightSidebar from "./components/RightSidebar";
import ContextMenu from "./components/ContextMenu";
import ProjectModal from "./components/ProjectModal";

const OUTLIER_COLOR = "#ff00ff"; // magenta: deliberately far from any class colour or the #750000 accent

function App() {
  // shortcut (ctrl z,y,c,v) states
  const pastRef = useRef([]); // undo stack
  const futureRef = useRef([]); // redo stack
  const clipboardRef = useRef([]);
  const stateRef = useRef({}); // keeps track of bbox states
  const lastSavedRef = useRef(null);
  const intervalRef = useRef(null);

  // grab states from zustand store
  const {
    videoName,
    frameCount,
    currentFrame,
    fps,
    isPlaying,
    frameInterval,
    mode,
    quality,
    bboxesByFrame,
    classes,
    classColors,
    tags,
    selectedBboxIds,
    contextMenu,
    showStatsModal,
    showChipsModal,
    outliers,
    activeClass,
    saveSession,
    prevFrame,
    nextFrame,
    openContextMenu,
    addBbox,
    updateBboxes,
    deleteBboxes,
  } = useStore((s) => s);

  // store bbox info for each frame
  const frameBboxes = bboxesByFrame[currentFrame] ?? [];

  // format time into HH:MM:SS
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  // update history log (used for undo/redo)
  function pushHistory() {
    pastRef.current.push(JSON.parse(JSON.stringify(stateRef.current)));
    if (pastRef.current.length > 50) pastRef.current.shift(); // cap at 50
    futureRef.current = []; // clear redo stack on new action
  }

  // function to undo previous action (ctrl z)
  function undo() {
    if (pastRef.current.length === 0) return;
    futureRef.current.unshift(JSON.parse(JSON.stringify(stateRef.current)));
    const snap = pastRef.current.pop();
    useStore.setState({
      bboxesByFrame: snap.bboxesByFrame,
      classes: snap.classes,
      classColors: snap.classColors,
      tags: snap.tags,
    });
  }

  // function to redo (ctrl y)
  function redo() {
    if (futureRef.current.length === 0) return;
    pastRef.current.push(JSON.parse(JSON.stringify(stateRef.current)));
    const snap = futureRef.current.shift();
    useStore.setState({
      bboxesByFrame: snap.bboxesByFrame,
      classes: snap.classes,
      classColors: snap.classColors,
      tags: snap.tags,
    });
  }

  // function to copy (ctrl c)
  function copyBboxes() {
    const selected = frameBboxes.filter((b) => selectedBboxIds.includes(b.id));
    if (selected.length === 0) return;
    clipboardRef.current = selected;
  }

  // function to paste (ctrl v)
  function pasteBboxes() {
    if (clipboardRef.current.length === 0) return;
    pushHistory();
    const newBboxes = clipboardRef.current.map((b) => ({
      ...b,
      id: crypto.randomUUID(),
      x: b.x + 10,
      y: b.y + 10,
    }));
    useStore.setState({
      bboxesByFrame: {
        ...bboxesByFrame,
        [currentFrame]: [...frameBboxes, ...newBboxes],
      },
      selectedBboxIds: newBboxes.map((b) => b.id),
    });
  }

  // expose pushHistory to store actions that need it
  useStore.getState().pushHistory = pushHistory;

  // keep stateRef current
  useEffect(() => {
    stateRef.current = { bboxesByFrame, classes, classColors, tags };
  }, [bboxesByFrame, classes, classColors, tags]);

  // autosave annotations, only autosave if new bboxes drawn
  useEffect(() => {
    if (!videoName) return;
    const interval = setInterval(() => {
      const current = JSON.stringify(bboxesByFrame);
      if (current === lastSavedRef.current) return; // nothing changed, skip
      saveSession().then(() => {
        lastSavedRef.current = JSON.stringify(bboxesByFrame);
        useStore.setState({ showSaved: true });
        setTimeout(() => useStore.setState({ showSaved: false }), 5000);
      });
    }, 5000); // every 5 secs

    return () => clearInterval(interval);
  }, [videoName, bboxesByFrame, classes, classColors]);

  // keyboard controls
  useEffect(() => {
    if (!videoName) return;
    function handleKeyDown(e) {
      // ctrl shortcuts
      if (e.ctrlKey) {
        if (!["s", "z", "y", "c", "v", "a"].includes(e.key)) return;
        e.preventDefault();
        if (e.key === "s")
          saveSession().then(() => {
            lastSavedRef.current = JSON.stringify(bboxesByFrame);
            useStore.setState({ showSaved: true });
            setTimeout(() => useStore.setState({ showSaved: false }), 5000);
          });
        if (e.key === "z") undo();
        if (e.key === "y") redo();
        if (e.key === "c") copyBboxes();
        if (e.key === "v") pasteBboxes();
        if (e.key === "a")
          useStore.setState({ selectedBboxIds: frameBboxes.map((b) => b.id) }); // ctrl+a to select all boxes
        return;
      }

      // other shortcuts
      if (e.key === "ArrowLeft") prevFrame(); // regular 1 frame skip
      if (e.key === "ArrowRight") nextFrame();
      if (e.key === ",")
        useStore.setState({
          currentFrame: Math.max(0, currentFrame - frameInterval),
        }); // keyframe interval skip
      if (e.key === ".")
        useStore.setState({
          currentFrame: Math.min(frameCount - 1, currentFrame + frameInterval),
        }); // mapped to unshifted < > keys
      if (e.key === " ") {
        e.preventDefault(); // to prevent spacebar from triggering file explorer directly after video upload
        useStore.setState({ isPlaying: !isPlaying });
      }
      if (e.key === "w" || e.key === "W")
        useStore.setState({ mode: mode === "draw" ? "select" : "draw" }); // toggle between select and draw mode
      // propagate the single selected box forward with csrt when press p
      if ((e.key === "p" || e.key === "P") && selectedBboxIds.length === 1) {
        e.preventDefault();
        if (!useStore.getState().isPropagating)
          useStore.getState().propagateBox(selectedBboxIds[0]);
      }
      if ((e.key === "f" || e.key === "F") && selectedBboxIds.length === 1) {
        e.preventDefault();
        if (!useStore.getState().isMarkingFa)
          useStore.getState().markFaTrack(selectedBboxIds[0]);
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedBboxIds.length > 0
      ) {
        // delete bbox if selected + hit backspace/del
        e.preventDefault();
        deleteBboxes(selectedBboxIds);
        useStore.setState({ selectedBboxIds: [] });
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
    isPlaying,
    mode,
  ]);

  // context menu: close on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      useStore.setState({ contextMenu: null, selectedBboxIds: [] });
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // video playback
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        const { currentFrame, frameCount } = useStore.getState();
        if (currentFrame >= frameCount - 1) {
          useStore.setState({ isPlaying: false });
          return;
        }
        useStore.setState({ currentFrame: currentFrame + 1 });
      }, 1000 / fps);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, frameCount]);

  // UI block
  return (
    <div style={{ display: "flex", height: "100vh", textAlign: "center" }}>
      <LeftSidebar />

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
        <Toolbar saveSession={saveSession} lastSavedRef={lastSavedRef} />

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
              setSelectedBboxIds={(ids) =>
                useStore.setState({ selectedBboxIds: ids })
              }
              openContextMenu={openContextMenu}
              mode={mode}
              updateBboxes={updateBboxes}
              onDimsReady={(dims) => useStore.setState({ imageDims: dims })}
              outlierBboxIds={outliers.map((o) => o.bbox_id)}
              outlierColor={OUTLIER_COLOR}
            />{" "}
            {/* calls fastAPI for image */}
            <VideoScrubber
              formatTime={formatTime}
              prevFrame={prevFrame}
              nextFrame={nextFrame}
            />
          </div>
        )}
      </div>

      <RightSidebar OUTLIER_COLOR={OUTLIER_COLOR} />

      <ContextMenu OUTLIER_COLOR={OUTLIER_COLOR} />

      {/* video selection for export to csv */}
      <ProjectModal
        show={showStatsModal}
        setShow={(v) => useStore.setState({ showStatsModal: v })}
        mode="stats"
      />

      {/* video selection for chip export */}
      <ProjectModal
        show={showChipsModal}
        setShow={(v) => useStore.setState({ showChipsModal: v })}
        mode="chips"
      />
    </div>
  );
}

export default App;
