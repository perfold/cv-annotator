import useStore from "../../store";

function TagsPanel() {
  const {
    tags,
    newTagName,
    selectedBboxIds,
    bboxesByFrame,
    currentFrame,
    addTag,
    deleteTag,
    toggleBboxTag,
  } = useStore((s) => s);

  const frameBboxes = bboxesByFrame[currentFrame] ?? [];

  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      {/* new tag input */}
      <input
        type="text"
        value={newTagName}
        onChange={(e) => useStore.setState({ newTagName: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") addTag();
        }}
        placeholder="Add new tag"
        style={{ width: "100%", boxSizing: "border-box" }}
      />
      <button onClick={addTag}>Add</button>
      {/* tag list & application of tags on bbox */}
      {selectedBboxIds.length === 0 && (
        <p style={{ color: "#888", fontSize: 12 }}>
          Select a bbox to apply tags.
        </p>
      )}
      {selectedBboxIds.length > 1 && (
        <p style={{ color: "#888", fontSize: 12 }}>
          {selectedBboxIds.length} boxes selected.
        </p>
      )}
      <ul style={{ textAlign: "left", padding: "0 4px", listStyle: "none" }}>
        {tags.map((tag) => {
          const selectedBboxes = frameBboxes.filter((b) =>
            selectedBboxIds.includes(b.id),
          );
          const isChecked =
            selectedBboxes.length > 0 &&
            selectedBboxes.every((b) => (b.tags ?? []).includes(tag));
          return (
            <li
              key={tag}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 0",
              }}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={selectedBboxIds.length === 0}
                onChange={() =>
                  selectedBboxIds.forEach((id) => toggleBboxTag(id, tag))
                }
              />
              <span
                style={{
                  background: "#750000",
                  color: "#FFFFFF",
                  borderRadius: 3,
                  padding: "1px 5px",
                  fontSize: 11,
                }}
              >
                {tag}
              </span>
              <button
                onClick={() => deleteTag(tag)}
                style={{ marginLeft: "auto" }}
              >
                x
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default TagsPanel;
