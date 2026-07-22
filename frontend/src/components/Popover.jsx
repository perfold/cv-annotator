import { useRef, useState, useLayoutEffect, useEffect } from "react";
import useStore from "../store";

function Popover({ name, title, children }) {
  const openPopover = useStore((s) => s.ui.openPopover);
  const setPopover = useStore((s) => s.setPopover);
  const isOpen = openPopover === name;

  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) {
      setPos(null);
      return;
    }
    const { width, height } = menuRef.current.getBoundingClientRect();
    const margin = 8;
    // centre horizontally
    let x = (window.innerWidth - width) / 2;
    let y = Math.max(margin, window.innerHeight * 0.18);
    if (y + height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - height - margin);
    }
    if (x < margin) x = margin;
    setPos({ x, y });
  }, [isOpen]);

  // esc closes the popover
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, setPopover]);

  if (!isOpen) return null;

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 1500 }}
        onClick={() => setPopover(null)}
      />
      <div
        ref={menuRef}
        style={{
          position: "fixed",
          top: pos ? pos.y : 0,
          left: pos ? pos.x : 0,
          visibility: pos ? "visible" : "hidden",
          background: "#1a1a1a",
          border: "1px solid #555",
          borderRadius: 4,
          zIndex: 1501,
          minWidth: 260,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()} // prevent the backdrop from closing when clicking inside
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 10px",
            borderBottom: "1px solid #333",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
          <button
            tabIndex={-1}
            onClick={() => setPopover(null)}
            style={{ padding: "0 6px", lineHeight: 1.4 }}
          >
            x
          </button>
        </div>
        <div
          style={{
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

export default Popover;
