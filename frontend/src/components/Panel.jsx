import useStore from "../store";

function Panel({ name, title, children }) {
  const togglePanel = useStore((s) => s.togglePanel);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        border: "1px solid #ccc",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      {/* title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 6px",
          borderBottom: "1px solid #ccc",
          flexShrink: 0,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
        <button
          tabIndex={-1}
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
    </div>
  );
}

export default Panel;
