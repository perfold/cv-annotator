function ProjectModal({
  show,
  setShow,
  mode, // "stats" | "chips"
  isLoadingProjects,
  projectsList,
  selectedProjects,
  setSelectedProjects,
  toggleProject,
  exportSelectedStats,
  exportChips,
  isExportingChips,
}) {
  if (!show) return null;

  const isChips = mode === "chips";

  return (
    <>
      {/* video selection for export to csv / chip export */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000,
        }}
        onClick={() => setShow(false)}
      >
        <div
          style={{
            background: "#1a1a1a",
            border: "1px solid #555",
            borderRadius: 8,
            padding: 24,
            minWidth: 420,
            maxHeight: "70vh",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 style={{ margin: 0 }}>{isChips ? "Export Chips" : "Export Stats"}</h3>
          {isLoadingProjects ? (
            <p style={{ color: "#888" }}>Loading projects...</p>
          ) : projectsList.length === 0 ? (
            <p style={{ color: "#888" }}>No saved projects found.</p>
          ) : (
            <>
              {/* select all toggle */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderBottom: "1px solid #333",
                  paddingBottom: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedProjects.length === projectsList.length}
                  onChange={() =>
                    setSelectedProjects(
                      selectedProjects.length === projectsList.length
                        ? []
                        : projectsList.map((p) => p.video_name),
                    )
                  }
                />
                <span style={{ fontWeight: "bold" }}>
                  Select all ({projectsList.length})
                </span>
              </div>

              {/* video/project list */}
              <div
                style={{
                  overflowY: "auto",
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
                        ? "#2a2a2a"
                        : "transparent",
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
                      <span style={{ fontWeight: "bold", fontSize: 13 }}>
                        {p.video_name}
                      </span>
                      <span style={{ color: "#888", fontSize: 11 }}>
                        {p.bbox_count} bboxes · {p.class_count} classes ·{" "}
                        {p.frame_count} annotated frames
                      </span>
                      <span style={{ color: "#555", fontSize: 10 }}>
                        {p.classes.join(", ") || "no classes"}
                      </span>
                      <span style={{ color: "#444", fontSize: 10 }}>
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
              borderTop: "1px solid #333",
              paddingTop: 12,
            }}
          >
            {isChips && isExportingChips && (
              <span style={{ fontSize: 12, color: "#888" }}>
                Exporting chips, please wait...
              </span>
            )}
            <button
              tabIndex={-1}
              onClick={() => setShow(false)}
              disabled={isChips && isExportingChips}
            >
              Cancel
            </button>
            <button
              tabIndex={-1}
              disabled={selectedProjects.length === 0 || (isChips && isExportingChips)}
              onClick={async () => {
                await (isChips ? exportChips() : exportSelectedStats());
                setShow(false);
              }}
              style={{
                background: "#750000",
                color: "#fff",
                border: "none",
                padding: "6px 16px",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {isChips && isExportingChips
                ? "Exporting..."
                : `Export${selectedProjects.length > 0 ? ` (${selectedProjects.length})` : ""}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ProjectModal;
