import { useRef } from "react";
import useStore from "../store";

// adjusts column's vertical split
function ColumnDivider({ edge }) {
  const setColumnSplit = useStore((s) => s.setColumnSplit);
  const dragRef = useRef(null);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const column = e.currentTarget.parentElement;
    const rect = column.getBoundingClientRect();
    dragRef.current = { top: rect.top, height: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d || d.height === 0) return;
    setColumnSplit(edge, (e.clientY - d.top) / d.height);
  }

  function onPointerUp(e) {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        height: 6,
        flexShrink: 0,
        cursor: "ns-resize",
        touchAction: "none",
        background: "#333",
        borderRadius: 2,
      }}
    />
  );
}

export default ColumnDivider;
