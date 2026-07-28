import useStore from "../../store";
import { THEME } from "../../constants";
import Popover from "../Popover";

function ExportSelectorPopover() {
  const isLoadingProjects = useStore((s) => s.isLoadingProjects);
  const projectsList = useStore((s) => s.projectsList);
  const selectedProjects = useStore((s) => s.selectedProjects);
  const isExportingChips = useStore((s) => s.isExportingChips);
  const toggleProject = useStore((s) => s.toggleProject);
  const exportSelectedStats = useStore((s) => s.exportSelectedStats);
  const exportChips = useStore((s) => s.exportChips);
  const openPopover = useStore((s) => s.ui.openPopover);
  const setPopover = useStore((s) => s.setPopover);

  const isStats = openPopover === "stats";
  const isChips = openPopover === "chips";
  if (!isStats && !isChips) return null;

  return (
    <Popover
      name={isChips ? "chips" : "stats"}
      title={isChips ? "Export Chips" : "Export Stats"}
      center
    >
      <div
        style={{
          width: 480,
          maxWidth: "90vw",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
        }}
      >
        {isLoadingProjects ? (
          <p style={{ color: THEME.label, margin: 0 }}>Loading projects...</p>
        ) : projectsList.length === 0 ? (
          <p style={{ color: THEME.label, margin: 0 }}>
            No saved projects found.
          </p>
        ) : (
          <>
            {/* select all toggle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderBottom: `1px solid ${THEME.divider}`,
                paddingBottom: 8,
                flexShrink: 0, // prevent button from moving when user scrolls
              }}
            >
              <input
                type="checkbox"
                checked={selectedProjects.length === projectsList.length}
                onChange={() =>
                  useStore.setState({
                    selectedProjects:
                      selectedProjects.length === projectsList.length
                        ? []
                        : projectsList.map((p) => p.video_name),
                  })
                }
              />
              <span style={{ fontWeight: "bold" }}>
                Select all ({projectsList.length})
              </span>
            </div>

            {/* video/project list */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {projectsList.map((p) => (
                <label
                  key={p.video_name}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "6px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    textAlign: "left",
                    background: selectedProjects.includes(p.video_name)
                      ? THEME.surfaceRaised
                      : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!selectedProjects.includes(p.video_name))
                      e.currentTarget.style.background = THEME.hover;
                  }}
                  onMouseLeave={(e) => {
                    if (!selectedProjects.includes(p.video_name))
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedProjects.includes(p.video_name)}
                    onChange={() => toggleProject(p.video_name)}
                    style={{ marginTop: 2 }}
                  />
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span style={{ fontWeight: "bold", fontSize: 14 }}>
                      {p.video_name}
                    </span>
                    <span style={{ color: THEME.label, fontSize: 12 }}>
                      {p.bbox_count} bboxes · {p.class_count} classes ·{" "}
                      {p.frame_count} annotated frames
                    </span>
                    <span style={{ color: THEME.faint, fontSize: 10 }}>
                      {p.classes.join(", ") || "no classes"}
                    </span>
                    <span style={{ color: THEME.faint, fontSize: 10 }}>
                      Saved:{" "}
                      {p.saved_at !== "unknown"
                        ? new Date(p.saved_at).toLocaleString()
                        : "unknown"}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        {/* footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            borderTop: `1px solid ${THEME.divider}`,
            paddingTop: 12,
            flexShrink: 0, // prevent cancel/export buttons from moving when user scrolls
          }}
        >
          {isChips && isExportingChips && (
            <span style={{ fontSize: 12, color: THEME.label }}>
              Exporting chips, please wait...
            </span>
          )}
          <button
            tabIndex={-1}
            onClick={() => setPopover(null)}
            disabled={isChips && isExportingChips}
            style={{
              background: THEME.hover,
              color: THEME.border,
              border: "none",
              padding: "6px 16px",
              borderRadius: THEME.radius,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            tabIndex={-1}
            disabled={
              selectedProjects.length === 0 || (isChips && isExportingChips)
            }
            onClick={async () => {
              await (isChips ? exportChips() : exportSelectedStats());
              setPopover(null);
            }}
            style={{
              background: THEME.accent,
              color: THEME.text,
              border: "none",
              padding: "6px 16px",
              borderRadius: THEME.radius,
              cursor: "pointer",
            }}
          >
            {isChips && isExportingChips
              ? "Exporting..."
              : `Export${selectedProjects.length > 0 ? ` (${selectedProjects.length})` : ""}`}
          </button>
        </div>
      </div>
    </Popover>
  );
}

export default ExportSelectorPopover;
