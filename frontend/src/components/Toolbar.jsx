function Toolbar({
  videoName,
  uploadVideo,
  loadFrameFolder,
  importXML,
  exportCVATXML,
  openStatsModal,
  openChipsModal,
  saveSession,
  bboxesByFrame,
  classes,
  classColors,
  lastSavedRef,
  setShowSaved,
  showSaved,
  mode,
  setMode,
  quality,
  changeQuality,
  isExtracting,
}) {
  return (
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
  );
}

export default Toolbar;
