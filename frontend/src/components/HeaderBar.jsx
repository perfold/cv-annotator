import useStore from "../store";
import { HEADER_GROUPS } from "../keymap";

function HeaderBar() {
  const { mode, ui, togglePanel, setPopover } = useStore((s) => s);

  function fire(action) {
    if (action.startsWith("panel:")) {
      togglePanel(action.slice(6));
      return;
    }
    if (action.startsWith("popover:")) {
      setPopover(action.slice(8));
      return;
    }
    if (action === "mode:toggle") {
      useStore.setState({ mode: mode === "draw" ? "select" : "draw" });
    }
  }

  // a label reads as active when the thing it controls is showing
  function isActive(action) {
    if (action.startsWith("panel:")) return ui.panels[action.slice(6)]?.open;
    if (action.startsWith("popover:"))
      return ui.openPopover === action.slice(8);
    return false;
  }

  // header style
  const labelStyle = (active) => ({
    fontWeight: "bold",
    fontSize: 13,
    textAlign: "center",
    padding: "2px 6px",
    background: active ? "#750000" : "transparent",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    width: "100%",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        borderBottom: "2px solid #ccc",
        padding: "4px 8px",
        flexShrink: 0,
        gap: 8,
      }}
    >
      {HEADER_GROUPS.map((group, gi) => (
        <div
          key={gi}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 2,
          }}
        >
          {group.map((item) => {
            if (item.action === "mode:toggle") {
              return (
                <button
                  key={item.id}
                  tabIndex={-1}
                  onClick={() => fire(item.action)}
                  style={{
                    ...labelStyle(false),
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "stretch",
                    gap: 0,
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      textAlign: "right",
                      background: mode === "draw" ? "#750000" : "transparent",
                      padding: "2px 6px",
                    }}
                  >
                    draw
                  </span>
                  <span style={{ padding: "2px 2px", flexShrink: 0 }}>/</span>
                  <span
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: mode === "select" ? "#750000" : "transparent",
                      padding: "2px 6px",
                    }}
                  >
                    select
                  </span>
                  <span style={{ padding: "2px 4px", flexShrink: 0 }}>
                    ({item.key})
                  </span>
                </button>
              );
            }
            return (
              <button
                key={item.id}
                tabIndex={-1}
                onClick={() => fire(item.action)}
                style={labelStyle(isActive(item.action))}
              >
                {item.label} ({item.key})
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default HeaderBar;
