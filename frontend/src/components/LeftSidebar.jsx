import useStore from "../store";

function LeftSidebar() {
  const {
    activeClass,
    newClassName,
    classes,
    classColors,
    tags,
    newTagName,
    selectedBboxIds,
    bboxesByFrame,
    currentFrame,
    yoloConf,
    matchThresh,
    maxLost,
    videoName,
    isRunningYolo,
    isExtracting,
    isTightening,
    addClass,
    deleteClass,
    addTag,
    deleteTag,
    toggleBboxTag,
    runYolo,
    runTrackingWithReId,
    samTightenFrame,
  } = useStore((s) => s);

  const frameBboxes = bboxesByFrame[currentFrame] ?? [];

  return (
    <>
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
            onChange={(e) =>
              useStore.setState({ newClassName: e.target.value })
            }
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
                onClick={() => useStore.setState({ activeClass: className })}
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
                    useStore.setState({
                      classColors: {
                        ...classColors,
                        [className]: e.target.value,
                      },
                    })
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
            onChange={(e) => useStore.setState({ newTagName: e.target.value })}
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
                onChange={(e) =>
                  useStore.setState({ yoloConf: parseFloat(e.target.value) })
                }
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
                onChange={(e) =>
                  useStore.setState({ matchThresh: parseFloat(e.target.value) })
                }
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
                onChange={(e) =>
                  useStore.setState({ maxLost: parseInt(e.target.value) })
                }
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
            {/* run bytetrack with visual re-id */}
            <button
              style={{ width: "100%", marginTop: 4 }}
              tabIndex={-1}
              disabled={!videoName || isRunningYolo || isExtracting}
              onClick={runTrackingWithReId}
            >
              {isRunningYolo ? "Running…" : "Run Tracking + Re-ID"}
            </button>
            {/* run fastsam-s to snap every box in this frame into a polygon */}
            <button
              style={{ width: "100%", marginTop: 4 }}
              tabIndex={-1}
              disabled={!videoName || isTightening}
              onClick={() => samTightenFrame()}
            >
              {isTightening ? "Tightening…" : "Run FastSAM (Polygon)"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default LeftSidebar;
