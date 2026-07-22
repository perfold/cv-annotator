import useStore from "../../store";
import Popover from "../Popover";

// note: the hidden file inputs these buttons click live in App.jsx, not here.
// the popover unmounts when closed, so an input mounted inside it would be gone
// by the time getElementById ran
function ImportPopover() {
  const { videoName, quality, isExtracting, loadFrameFolder, changeQuality } =
    useStore((s) => s);

  return (
    <Popover name="import" title="Import">
      {/* video input button */}
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        onClick={() => document.getElementById("video-input").click()}
      >
        Upload Video
      </button>

      {/* frame folder path input */}
      <input
        type="text"
        placeholder="Absolute Path"
        id="folder-path-input"
        style={{ width: "100%", boxSizing: "border-box" }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") loadFrameFolder(e.target.value.trim());
        }}
      />

      {/* import .xml file */}
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={() => document.getElementById("import-xml-input").click()}
      >
        Import XML
      </button>

      {/* frame quality toggle */}
      {videoName && (
        <div
          style={{
            borderTop: "1px solid #333",
            paddingTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <h4 style={{ margin: 0, fontSize: 13 }}>Quality</h4>
          {["low", "medium", "high"].map((q) => (
            <button
              key={q}
              tabIndex={-1}
              disabled={isExtracting}
              onClick={() => changeQuality(q)}
              style={{
                flex: 1,
                fontWeight: quality === q ? "bold" : "normal",
                background: quality === q ? "#750000" : "",
                color: quality === q ? "#fff" : "",
                padding: "4px",
              }}
            >
              {q.charAt(0).toUpperCase() + q.slice(1)}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export default ImportPopover;
