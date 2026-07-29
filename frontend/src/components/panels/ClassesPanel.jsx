import { useState } from "react";
import useStore from "../../store";
import { THEME } from "../../constants";

function ClassesPanel() {
  const {
    activeClass,
    newClassName,
    classes,
    classColors,
    addClass,
    deleteClass,
    renameClass,
  } = useStore((s) => s);

  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");

  const startEdit = (className) => {
    setEditing(className);
    setDraft(className);
  };

  const commitEdit = () => {
    if (editing !== null) renameClass(editing, draft);
    setEditing(null);
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      {/* shows selected class */}
      <p style={{ margin: "0 0 4px 0" }}>
        Active class: {activeClass ?? "N/A"}
      </p>{" "}
      {/* new class input */}
      <input
        type="text"
        value={newClassName}
        onChange={(e) => useStore.setState({ newClassName: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") addClass();
        }}
        placeholder="Enter new class"
        style={{ width: "100%", boxSizing: "border-box" }}
      />
      {/* button to add new class */}
      <button onClick={addClass}>Add</button>
      <ul style={{ padding: "0 8px", margin: "4px 0 0 0", listStyle: "none" }}>
        {/* class list & highlight (upon selection) */}
        {classes.map((className) => (
          <li
            key={className}
            onClick={() => useStore.setState({ activeClass: className })}
            style={{
              fontWeight: activeClass === className ? "bold" : "normal",
              backgroundColor:
                activeClass === className ? THEME.accent : "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              padding: "2px 4px",
            }}
          >
            <input
              type="color"
              value={classColors[className] ?? "#ffffff"}
              onChange={(e) =>
                useStore.setState({
                  classColors: {
                    ...classColors,
                    [className]: e.target.value,
                  },
                })
              } // lets you pick which colour you want
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 20,
                height: 20,
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            />
            {editing === className ? (
              <input
                type="text"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()} // don't reselect the class underneath
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  e.stopPropagation(); // otherwise every letter fires a global hotkey
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditing(null);
                }}
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box" }}
              />
            ) : (
              <span // double click to rename
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEdit(className);
                }}
              >
                {className}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteClass(className);
              }}
            >
              x
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ClassesPanel;
