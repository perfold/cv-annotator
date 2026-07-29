import useStore from "../../store";
import { OUTLIER_COLOR, FA_COLOR, THEME } from "../../constants";

const FA_CLASS = "false-alarm";

function AnnotationsPanel() {
  const {
    bboxesByFrame,
    currentFrame,
    selectedBboxIds,
    outliers,
    videoName,
    openContextMenu,
    deleteBbox,
    toggleBboxTag,
    hideAllBboxes,
    showOnlyFlagged,
  } = useStore((s) => s);

  const frameBboxes = bboxesByFrame[currentFrame] ?? [];

  const rowStyle = (b) => {
    const isSelected = selectedBboxIds.includes(b.id);
    const flag =
      b.className === FA_CLASS
        ? FA_COLOR
        : outliers.some((o) => o.bbox_id === b.id)
          ? OUTLIER_COLOR
          : null;

    return {
      cursor: "pointer",
      background: flag
        ? `${flag}${isSelected ? "55" : "22"}`
        : isSelected
          ? THEME.hover
          : "transparent",
      border: flag
        ? `1px solid ${flag}`
        : isSelected
          ? `1px solid ${THEME.faint}`
          : "1px solid transparent",
      borderRadius: 3,
      marginBottom: 2,
    };
  };

  return (
    <>
      {/* annotations list */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {frameBboxes.length === 0 ? (
          <p style={{ color: THEME.label }}>No annotations yet.</p>
        ) : (
          <ul style={{ textAlign: "left", padding: "0 16px", margin: 0 }}>
            {frameBboxes.map((b, i) => (
              <li
                key={b.id}
                title={b.id}
                onClick={() => useStore.setState({ selectedBboxIds: [b.id] })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu(e.clientX, e.clientY, b.id);
                }}
                style={rowStyle(b)}
              >
                {i + 1}. {b.className}{" "}
                {b.trackId !== null && b.trackId !== undefined && (
                  <span style={{ color: THEME.label, fontSize: 11 }}>
                    {`#${b.trackId}`}
                  </span>
                )}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBboxTag(b.id, tag);
                    }}
                    title={`remove ${tag}`}
                    style={{
                      background: THEME.accent,
                      color: THEME.text,
                      borderRadius: 3,
                      padding: "1px 5px",
                      fontSize: 10,
                      marginLeft: 3,
                      cursor: "pointer",
                    }}
                  >
                    {tag}
                  </span>
                ))}{" "}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteBbox(b.id);
                  }}
                  style={{ marginLeft: 4 }}
                >
                  x
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* view toggles: hide all and show only flagged*/}
      <div
        style={{
          borderTop: `1px solid ${THEME.border}`,
          flexShrink: 0,
          display: "flex",
          gap: 4,
          paddingTop: 4,
        }}
      >
        <button
          style={{
            flex: 1,
          }}
          tabIndex={-1}
          disabled={!videoName}
          onClick={() => useStore.setState({ hideAllBboxes: !hideAllBboxes })}
        >
          {hideAllBboxes ? "Show all (H)" : "Hide all (H)"}
        </button>
        <button
          style={{
            flex: 1,
          }}
          tabIndex={-1}
          disabled={!videoName}
          onClick={() =>
            useStore.setState({ showOnlyFlagged: !showOnlyFlagged })
          }
        >
          {showOnlyFlagged ? "Only flagged ✓ (L)" : "Only flagged (L)"}
        </button>
      </div>
    </>
  );
}

export default AnnotationsPanel;
