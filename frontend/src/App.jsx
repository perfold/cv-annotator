import { useEffect, useRef, useState } from "react";
import useStore from "./store";
import useHotkeys from "./useHotkeys";
import { PopoverActionsContext } from "./usePopoverKeys";
import AnnotationCanvas from "./components/AnnotationCanvas";
import HeaderBar from "./components/HeaderBar";
import Panel, { DOCK_EDGE_PX } from "./components/Panel";
import ColumnDivider from "./components/ColumnDivider";
import AnnotationsPanel from "./components/panels/AnnotationsPanel";
import ClassesPanel from "./components/panels/ClassesPanel";
import OutliersPanel from "./components/panels/OutliersPanel";
import TagsPanel from "./components/panels/TagsPanel";
import ImportPopover from "./components/popovers/ImportPopover";
import ExportPopover from "./components/popovers/ExportPopover";
import ModelsPopover from "./components/popovers/ModelsPopover";
import VideoScrubber from "./components/VideoScrubber";
import ContextMenu from "./components/ContextMenu";
import ProjectModal from "./components/ProjectModal";
import { OUTLIER_COLOR } from "./constants";

function App() {
  // shortcut (ctrl z,y,c,v) states
  const pastRef = useRef([]); // undo stack
  const futureRef = useRef([]); // redo stack
  const clipboardRef = useRef([]);
  const stateRef = useRef({}); // keeps track of bbox states
  const lastSavedRef = useRef(null);
  const intervalRef = useRef(null);
  const popoverActions = useRef({});
  const [dockHint, setDockHint] = useState(null);

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
    hideAllBboxes,
    showOnlyFlagged,
    ui,
    uploadVideo,
    importXML,
    showSaved,
    isExtracting,
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
      outliers: snap.outliers,
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
      outliers: snap.outliers,
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
    stateRef.current = { bboxesByFrame, classes, classColors, tags, outliers };
  }, [bboxesByFrame, classes, classColors, tags, outliers]);

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

  // panel/popover/bbox shortcuts live in keymap.js and dispatch through this hook
  useHotkeys({ videoName, popoverActions });

  // keyboard controls
  useEffect(() => {
    if (!videoName) return;
    function handleKeyDown(e) {
      // ignore keys typed into a text field
      const tag = e.target?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable;

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

      if (typing) return;

      // frame navigation
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

  // is pointer at left or right side
  function edgeAt(clientX) {
    if (clientX <= DOCK_EDGE_PX) return "left";
    if (clientX >= window.innerWidth - DOCK_EDGE_PX) return "right";
    return null;
  }

  function handleDragMove(name, clientX) {
    setDockHint(edgeAt(clientX));
  }

  // dock panel at the edge if its there, or leave it as a floating panel
  function handleDragEnd(name, clientX) {
    const edge = edgeAt(clientX);
    setDockHint(null);
    if (edge) useStore.getState().dockPanel(name, edge);
  }

  const isDocked = (p) => p.open && p.mode === "docked";
  const dockedLeft = ["annotations", "classes"].filter(
    (n) => isDocked(ui.panels[n]) && ui.panels[n].edge === "left",
  );
  const dockedRight = ["outliers", "tags"].filter(
    (n) => isDocked(ui.panels[n]) && ui.panels[n].edge === "right",
  );
  // a panel docked to the opposite side of its default still needs a home
  const extraLeft = ["outliers", "tags"].filter(
    (n) => isDocked(ui.panels[n]) && ui.panels[n].edge === "left",
  );
  const extraRight = ["annotations", "classes"].filter(
    (n) => isDocked(ui.panels[n]) && ui.panels[n].edge === "right",
  );
  const leftPanels = [...dockedLeft, ...extraLeft];
  const rightPanels = [...dockedRight, ...extraRight];
  const floatingPanels = Object.keys(ui.panels).filter(
    (n) => ui.panels[n].open && ui.panels[n].mode === "floating",
  );

  const PANEL_CONTENT = {
    annotations: { title: "Annotations", node: <AnnotationsPanel /> },
    classes: { title: "Classes", node: <ClassesPanel /> },
    outliers: { title: "Outlier Detection", node: <OutliersPanel /> },
    tags: { title: "Tags", node: <TagsPanel /> },
  };

  const renderPanel = (n, flex = 1) => (
    <Panel
      key={n}
      name={n}
      title={PANEL_CONTENT[n].title}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      flex={flex}
    >
      {PANEL_CONTENT[n].node}
    </Panel>
  );

  // a column of 2 panels gets a draggable divider and an adjustable split
  const renderColumn = (names, edge) => {
    if (names.length !== 2) return names.map((n) => renderPanel(n));
    const f = ui.columnSplit[edge];
    return [
      renderPanel(names[0], f),
      <ColumnDivider key={`${edge}-divider`} edge={edge} />,
      renderPanel(names[1], 1 - f),
    ];
  };

  return (
    <PopoverActionsContext.Provider value={popoverActions}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          textAlign: "center",
        }}
      >
        <HeaderBar />

        {/* file inputs */}
        <input
          type="file"
          accept="video/*"
          id="video-input"
          style={{ display: "none" }}
          onChange={(e) => uploadVideo(e.target.files[0])}
        />
        <input
          type="file"
          accept=".xml"
          id="import-xml-input"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files[0]) importXML(e.target.files[0]);
          }}
        />

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* left column: whichever panels are docked left, stacked */}
          {leftPanels.length > 0 && (
            <div
              style={{
                width: ui.panels[leftPanels[0]].size,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: 4,
                minHeight: 0,
              }}
            >
              {renderColumn(leftPanels, "left")}
            </div>
          )}

          {/* center area */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: "2px 8px",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              textAlign: "center",
            }}
          >
            {/* konva stage: image display */}
            {videoName && (
              <div
                style={{
                  width: "100%",
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    flexShrink: 0,
                  }}
                >
                  <p style={{ margin: "2px 0" }}>
                    Loaded: {videoName} ({frameCount} frames)
                  </p>{" "}
                  {/* shows total frame ct */}
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
                  {isExtracting && (
                    <span style={{ color: "#750000", fontSize: 14 }}>
                      Re-extracting frames, please wait...
                    </span>
                  )}
                </div>
                {/* annotation canvas */}
                <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
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
                    onDimsReady={(dims) =>
                      useStore.setState({ imageDims: dims })
                    }
                    outlierBboxIds={outliers.map((o) => o.bbox_id)}
                    outlierColor={OUTLIER_COLOR}
                    hideAllBboxes={hideAllBboxes}
                    showOnlyFlagged={showOnlyFlagged}
                  />{" "}
                  {/* calls fastAPI for image */}
                </div>
                <div style={{ flexShrink: 0 }}>
                  <VideoScrubber
                    formatTime={formatTime}
                    prevFrame={prevFrame}
                    nextFrame={nextFrame}
                  />
                </div>
              </div>
            )}
          </div>

          {/* right column: whichever panels are docked right, stacked */}
          {rightPanels.length > 0 && (
            <div
              style={{
                width: ui.panels[rightPanels[0]].size,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: 4,
                minHeight: 0,
              }}
            >
              {renderColumn(rightPanels, "right")}
            </div>
          )}
        </div>

        {/* floating panels */}
        {floatingPanels.map(renderPanel)}

        {/* edge hint */}
        {dockHint && (
          <div
            style={{
              position: "fixed",
              top: 0,
              bottom: 0,
              [dockHint]: 0,
              width: DOCK_EDGE_PX,
              background: "#75000055",
              border: "2px dashed #750000",
              pointerEvents: "none",
              zIndex: 899,
            }}
          />
        )}

        {/* popovers */}
        <ImportPopover />
        <ExportPopover saveSession={saveSession} lastSavedRef={lastSavedRef} />
        <ModelsPopover />

        <ContextMenu />

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
    </PopoverActionsContext.Provider>
  );
}

export default App;
