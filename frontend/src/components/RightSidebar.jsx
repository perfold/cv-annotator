import useStore from "../store";

function RightSidebar({ OUTLIER_COLOR }) {
  const {
    bboxesByFrame, currentFrame, selectedBboxIds, outliers,
    isScanning, sigmaThresh, rarePctThresh, videoName,
    openContextMenu, deleteBbox, scanOutliers,
    
  } = useStore((s) => s);

  const frameBboxes = bboxesByFrame[currentFrame] ?? [];

  return (
    <>
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
              onChange={(e) => useStore.setState({ sigmaThresh: parseFloat(e.target.value) })}
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
              onChange={(e) => useStore.setState({ rarePctThresh: parseFloat(e.target.value) })}
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
                    onClick={() => useStore.setState({ currentFrame: o.frame_idx })}
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
    </>
  );
}

export default RightSidebar;
