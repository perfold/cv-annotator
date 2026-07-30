import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { THEME } from "../constants";

// shows explanation for functions
function Tooltip({ text, children }) {
  const tipRef = useRef(null);
  const [pos, setPos] = useState(null);

  const show = (e) => {
    const el = e.currentTarget.firstElementChild ?? e.currentTarget;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    setPos({ x: r.left + r.width / 2, y: r.top });
  };
  const hide = () => setPos(null);

  useLayoutEffect(() => {
    if (!pos || !tipRef.current) return;
    const t = tipRef.current.getBoundingClientRect();
    const margin = 6;
    let left = pos.x - t.width / 2;
    if (left < margin) left = margin;
    if (left + t.width > window.innerWidth - margin)
      left = window.innerWidth - t.width - margin;
    const top = pos.y - t.height - 8;
    tipRef.current.style.left = `${left}px`;
    tipRef.current.style.top = `${top < margin ? pos.y + 20 : top}px`; // flip below if no room above
  }, [pos]);

  if (!text) return children;

  return (
    <span
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      style={{ display: "contents" }}
    >
      {children}
      {pos &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              zIndex: 2000,
              maxWidth: 240,
              background: THEME.surfaceRaised,
              color: THEME.text,
              border: `1px solid ${THEME.border}`,
              borderRadius: THEME.radius,
              padding: "6px 8px",
              fontSize: 11,
              lineHeight: 1.35,
              fontWeight: "normal",
              boxShadow: THEME.shadow,
              pointerEvents: "none",
              whiteSpace: "normal",
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}

export default Tooltip;
