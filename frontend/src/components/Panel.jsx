import { useRef } from "react";
import useStore from "../store";

const DOCK_EDGE_PX = 150; // how close to a screen edge a drop counts as docking

function Panel({ name, title, children, onDragMove, onDragEnd, flex = 1 }) {
  const panel = useStore((s) => s.ui.panels[name]);
  const { togglePanel, movePanel, resizePanel, floatPanel } = useStore(
    (s) => s,
  );

  const shellRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  const floating = panel.mode === "floating";

  // title bar drag
  function onTitlePointerDown(e) {
    if (e.button !== 0) return; // only left click drags
    e.preventDefault();
    const rect = shellRef.current.getBoundingClientRect();

    if (!floating) {
      floatPanel(name, rect.left, rect.top, rect.width, rect.height);
    }
    dragRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onTitlePointerMove(e) {
    if (!dragRef.current) return;
    const x = e.clientX - dragRef.current.offsetX;
    const y = e.clientY - dragRef.current.offsetY;
    movePanel(name, x, y);
    onDragMove?.(name, e.clientX, e.clientY);
  }

  function onTitlePointerUp(e) {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onDragEnd?.(name, e.clientX, e.clientY);
  }

  // resize handle
  function onResizePointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = shellRef.current.getBoundingClientRect();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
      invertX: panel.mode === "docked" && panel.edge === "right",
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onResizePointerMove(e) {
    const r = resizeRef.current;
    if (!r) return;
    const dx = (e.clientX - r.startX) * (r.invertX ? -1 : 1);
    resizePanel(name, r.startW + dx, r.startH + (e.clientY - r.startY));
  }

  function onResizePointerUp(e) {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const shellStyle = floating
    ? {
        position: "fixed",
        left: panel.x,
        top: panel.y,
        width: panel.w,
        height: panel.h,
        zIndex: 900,
        background: "#1a1a1a",
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        border: "1px solid #ccc",
        borderRadius: 3,
        overflow: "hidden",
      }
    : {
        flex,
        minHeight: 0,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        border: "1px solid #ccc",
        borderRadius: 3,
        overflow: "hidden",
      };

  return (
    <div ref={shellRef} style={shellStyle}>
      {/* title bar */}
      <div
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 6px",
          borderBottom: "1px solid #ccc",
          flexShrink: 0,
          cursor: "move",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
        <button
          tabIndex={-1}
          onPointerDown={(e) => e.stopPropagation()} // don't start a drag from the close button
          onClick={() => togglePanel(name)}
          title="close"
          style={{ padding: "0 6px", lineHeight: 1.4 }}
        >
          x
        </button>
      </div>

      {/* content slot */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "6px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>

      {/* resize handle */}
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        style={
          floating
            ? {
                position: "absolute",
                right: 0,
                bottom: 0,
                width: 14,
                height: 14,
                cursor: "nwse-resize",
                touchAction: "none",
                background:
                  "linear-gradient(135deg, transparent 50%, #ccc 50%, #ccc 60%, transparent 60%)",
              }
            : {
                position: "absolute",
                top: 0,
                bottom: 0,
                [panel.edge === "right" ? "left" : "right"]: 0,
                width: 6,
                cursor: "ew-resize",
                touchAction: "none",
              }
        }
      />
    </div>
  );
}

export { DOCK_EDGE_PX };
export default Panel;
