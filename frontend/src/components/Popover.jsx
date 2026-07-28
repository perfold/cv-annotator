import { useRef, useState, useLayoutEffect, useEffect } from "react";
import { THEME } from "../constants";
import useStore from "../store";

function Popover({ name, title, children, center = false }) {
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

    const place = () => {
      if (!menuRef.current) return;
      const { width, height } = menuRef.current.getBoundingClientRect();
      const margin = 8;
      // center horizontally and vertically
      let x = (window.innerWidth - width) / 2;
      let y = center
        ? Math.max(margin, (window.innerHeight - height) / 2)
        : Math.max(margin, window.innerHeight * 0.18);
      if (y + height > window.innerHeight - margin) {
        y = Math.max(margin, window.innerHeight - height - margin);
      }
      if (x < margin) x = margin;
      setPos({ x, y });
    };

    const el = menuRef.current;

    place(); // initial position when opened
    window.addEventListener("resize", place); // recentre when the window changes size

    // recentre when the popovers size changes (when content loads in and grows it)
    const ro = new ResizeObserver(place);
    ro.observe(el);

    return () => {
      window.removeEventListener("resize", place);
      ro.disconnect();
    };
  }, [isOpen, center]);

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
          background: THEME.surface,
          border: `1px solid ${THEME.border}`,
          borderRadius: THEME.radius,
          zIndex: 1501,
          minWidth: 260,
          maxHeight: "90vh",
          boxShadow: THEME.shadow,
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 10px",
            borderBottom: `1px solid ${THEME.divider}`,
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
            minHeight: 0,
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

export default Popover;
