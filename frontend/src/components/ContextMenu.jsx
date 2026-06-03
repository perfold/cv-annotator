function ContextMenu({
  contextMenu,
  classes,
  classColors,
  tags,
  frameBboxes,
  changeClass,
  toggleBboxTag,
  deleteBbox,
  setContextMenu,
}) {
  if (!contextMenu) return null;

  return (
    <>
      {/* context menu style */}
      <div
        style={{
          position: "fixed",
          top: contextMenu.y,
          left: contextMenu.x,
          background: "#1a1a1a",
          border: "1px solid #555",
          borderRadius: 4,
          zIndex: 1000,
          minWidth: 140,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside menu
      >
        <div
          style={{
            padding: "4px 10px",
            color: "#888",
            fontSize: 11,
            borderBottom: "1px solid #333",
          }}
        >
          {" "}
          {/* context menu text color */}
          Change class:
        </div>
        {/* class change toggle */}
        {classes.map((cls) => (
          <div
            key={cls}
            onClick={() => {
              changeClass(contextMenu.bboxId, cls);
              setContextMenu(null);
            }}
            style={{
              padding: "6px 12px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#333")} // color of background of mouse hover
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: classColors[cls] ?? "#fff",
                display: "inline-block",
              }}
            />
            {cls}
          </div>
        ))}
        {/* tag toggle */}
        <div
          style={{
            borderTop: "1px solid #333",
            borderBottom: "1px solid #333",
          }}
        >
          <div style={{ padding: "4px 10px", color: "#888", fontSize: 11 }}>
            Tags:
          </div>
          {tags.map((tag) => {
            const bbox = frameBboxes.find((b) => b.id === contextMenu.bboxId);
            const isChecked = bbox ? (bbox.tags ?? []).includes(tag) : false;
            return (
              <div
                key={tag}
                onClick={() => toggleBboxTag(contextMenu.bboxId, tag)}
                style={{
                  padding: "4px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#333")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {}}
                  style={{ pointerEvents: "none" }}
                />
                {tag}
              </div>
            );
          })}
        </div>
        <div style={{ borderTop: "1px solid #333" }}>
          {/* delete annotation button */}
          <div
            onClick={() => {
              deleteBbox(contextMenu.bboxId);
              setContextMenu(null);
            }}
            style={{
              padding: "6px 12px",
              cursor: "pointer",
              color: "#e74c3c",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#333")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            Delete
          </div>
        </div>
      </div>
    </>
  );
}

export default ContextMenu;
