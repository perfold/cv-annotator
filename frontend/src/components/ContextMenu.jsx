import useStore from "../store";

function ContextMenu() {
  const {
    contextMenu,
    classes,
    classColors,
    tags,
    bboxesByFrame,
    currentFrame,
    changeClass,
    toggleBboxTag,
    deleteBbox,
    propagateBox,
    isPropagating,
    markFaTrack,
    isMarkingFa,
    faMatchClass,
  } = useStore((s) => s);

  if (!contextMenu) return null;

  const frameBboxes = bboxesByFrame[currentFrame] ?? [];
  const manyClasses = classes.length >= 5; // if 5 or more classes (very long), switch to a 2-column layout

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
          display: "flex",
          flexDirection: manyClasses ? "row" : "column",
          alignItems: "stretch",
        }}
        onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside menu
      >
        {/* left column: class list (scrolls if very long)*/}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: manyClasses ? 320 : "none",
            overflowY: manyClasses ? "auto" : "visible",
            borderRight: manyClasses ? "1px solid #333" : "none",
          }}
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
            Change class:
          </div>
          {/* class change toggle */}
          {classes.map((cls) => (
            <div
              key={cls}
              onClick={() => {
                changeClass(contextMenu.bboxId, cls);
                useStore.setState({ contextMenu: null });
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
        </div>
        {/* right column: tags + propagate + delete. always visible regardless of how many classes there are */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
          }}
        >
          {/* tag toggle */}
          <div
            style={{
              borderTop: manyClasses ? "none" : "1px solid #333",
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
            {/* propagate box forward with csrt (manual box -> track across frames) */}
            <div
              onClick={() => {
                if (isPropagating) return;
                propagateBox(contextMenu.bboxId);
                useStore.setState({ contextMenu: null });
              }}
              style={{
                padding: "6px 12px",
                cursor: isPropagating ? "default" : "pointer",
                color: isPropagating ? "#666" : "#4af",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#333")}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              {isPropagating ? "Propagating…" : "Propagate forward (P)"}
            </div>
          </div>
          <div style={{ borderTop: "1px solid #333" }}>
            {/* track this box forward + tag every same-class box it hits as false-alarm */}
            <div
              onClick={() => {
                if (isMarkingFa) return;
                markFaTrack(contextMenu.bboxId);
                useStore.setState({ contextMenu: null });
              }}
              style={{
                padding: "6px 12px",
                cursor: isMarkingFa ? "default" : "pointer",
                color: isMarkingFa ? "#666" : "#e67e22",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#333")}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              {isMarkingFa ? "Marking FA…" : "Mark as FA (F)"}
            </div>
            {/* same-class toggle: on = only tag boxes matching the seed's class (mislabel case);
                off = tag any class the track hits (label-flickering FA, e.g. car/van/truck) */}
            <div
              onClick={(e) => {
                e.stopPropagation(); // toggle only, don't fire the mark or close the menu
                useStore.setState({ faMatchClass: !faMatchClass });
              }}
              style={{
                padding: "2px 12px 6px 12px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                fontSize: 11,
                color: "#888",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#333")}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <input
                type="checkbox"
                checked={faMatchClass}
                onChange={() => {}}
                style={{ pointerEvents: "none" }}
              />
              same class only
            </div>
          </div>
          <div style={{ borderTop: "1px solid #333" }}>
            {/* delete annotation button */}
            <div
              onClick={() => {
                deleteBbox(contextMenu.bboxId);
                useStore.setState({ contextMenu: null });
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
      </div>
    </>
  );
}

export default ContextMenu;
