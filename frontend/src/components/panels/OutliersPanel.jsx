import useStore from "../../store";
import { OUTLIER_COLOR, THEME } from "../../constants";
import Tooltip from "../Tooltip";

function OutliersPanel() {
  const {
    currentFrame,
    outliers,
    isScanning,
    embPctThresh,
    rarePctThresh,
    videoName,
    scanOutliers,
    confirmAllOutliers,
    removeAllFa,
    removeAllOutliers,
  } = useStore((s) => s);

  return (
    <>
      {/* bulk removal: deletes every box tagged "false-alarm", and every flagged outlier */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          gap: 4,
          marginBottom: 8,
        }}
      >
        {/* false-alarm removal, deletes every box tagged "false-alarm" */}
        <Tooltip text="deletes every false-alarm box at once">
          <button
            style={{ flex: 1 }}
            tabIndex={-1}
            disabled={!videoName}
            onClick={removeAllFa}
          >
            Remove all FA (D)
          </button>
        </Tooltip>
        {/* remove outlier button */}
        <Tooltip text="deletes every flagged box at once">
          <button
            style={{ flex: 1 }}
            tabIndex={-1}
            disabled={!videoName}
            onClick={removeAllOutliers}
          >
            Remove all Outliers (R)
          </button>
        </Tooltip>
      </div>

      {/* outlier detection section */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
          borderTop: `1px solid ${THEME.border}`,
          paddingTop: 8,
          width: "100%",
        }}
      >
        {/* embedding sensitivity slider: flags boxes whose nearest same-class neighbour is k MADs past the class-median distance (higher = stricter, fewer flags) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 4,
          }}
        >
          <Tooltip text="higher = flag less. lower = flags more">
            <label
              style={{
                fontSize: 11,
                width: 50,
                flexShrink: 0,
              }}
            >
              Sensitivity: {embPctThresh.toFixed(1)}
            </label>
          </Tooltip>
          <input
            type="range"
            min={2.0}
            max={8.0}
            step={0.5}
            value={embPctThresh}
            onChange={(e) =>
              useStore.setState({ embPctThresh: parseFloat(e.target.value) })
            }
            style={{ flex: 1, accentColor: THEME.accent }}
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
          <Tooltip text="flag classes almost never used">
            <label
              style={{
                fontSize: 11,
                width: 50,
                flexShrink: 0,
              }}
            >
              Rare: ≤{rarePctThresh.toFixed(1)}%
            </label>
          </Tooltip>
          <input
            type="range"
            min={0.1}
            max={5.0}
            step={0.1}
            value={rarePctThresh}
            onChange={(e) =>
              useStore.setState({ rarePctThresh: parseFloat(e.target.value) })
            }
            style={{ flex: 1, accentColor: THEME.accent }}
          />
        </div>

        {/* scan button */}
        <Tooltip text="finds weird-looking + rare boxes to check">
          <button
            style={{ width: "100%", marginBottom: 8 }}
            tabIndex={-1}
            disabled={!videoName || isScanning}
            onClick={scanOutliers}
          >
            {isScanning ? "Scanning..." : "Scan for Outliers (S)"}
          </button>
        </Tooltip>

        {/* outlier list */}
        {outliers.length === 0 ? (
          <p style={{ color: THEME.label, fontSize: 11, margin: 0 }}>
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
            {/* tag every listed outlier at once */}
            <Tooltip text="marks the whole found list as outliers">
              <button
                style={{ width: "100%", marginBottom: 4 }}
                tabIndex={-1}
                onClick={confirmAllOutliers}
              >
                Tag ALL as outlier
              </button>
            </Tooltip>
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
                  onClick={() =>
                    useStore.setState({
                      currentFrame: o.frame_idx,
                      selectedBboxIds: [o.bbox_id],
                    })
                  }
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
                  <span style={{ color: THEME.border }}>{o.class}</span>
                  <div style={{ color: THEME.faint, fontSize: 10 }}>
                    {o.reason === "rare_class"
                      ? "⚠ rare class"
                      : "⚠ visually different"}{" "}
                    : {o.detail}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

export default OutliersPanel;
