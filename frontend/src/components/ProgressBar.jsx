import useStore from "../store";
import { THEME } from "../constants";

// prog bar that appears whenever anything long runs (set busy in store.js)
function ProgressBar() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;

  const { label, done, total } = busy;
  const known = total > 0;
  const pct = known ? Math.min(99, Math.round((done / total) * 100)) : 0;

  return (
    <div
      style={{
        flexShrink: 0,
        width: "100%",
        boxSizing: "border-box",
        borderTop: `1px solid ${THEME.divider}`,
        padding: "6px 4px",
        marginTop: 4,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span style={{ color: THEME.text, fontSize: 12, whiteSpace: "nowrap" }}>
        {label}
      </span>

      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: THEME.divider,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: known ? `${pct}%` : "30%",
            background: THEME.accent,
            borderRadius: 3,
            transition: known ? "width 200ms linear" : "none",
            animation: known
              ? "none"
              : "cvatIndeterminate 1.2s ease-in-out infinite",
          }}
        />
      </div>

      <span
        style={{
          color: THEME.label,
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          minWidth: 90,
          textAlign: "right",
        }}
      >
        {known
          ? `${pct}% (${done}/${total})`
          : done > 0
            ? `${done}`
            : "working..."}
      </span>

      <style>{`
        @keyframes cvatIndeterminate {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(333%); }
        }
      `}</style>
    </div>
  );
}

export default ProgressBar;
