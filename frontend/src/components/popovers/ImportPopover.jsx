import { useRef } from "react";
import useStore from "../../store";
import Popover from "../Popover";
import usePopoverKeys from "../../usePopoverKeys";

function ImportPopover() {
  const { videoName, quality, isExtracting, loadFrameFolder, changeQuality } =
    useStore((s) => s);
  const pathRef = useRef(null);

  usePopoverKeys({
    "import:upload": () => document.getElementById("video-input").click(),
    "import:xml": () => {
      if (videoName) document.getElementById("import-xml-input").click();
    },
    "import:path": () => pathRef.current?.focus(),
    // quality re-extracts frames, so it needs a loaded video
    "import:quality:low": () =>
      videoName && !isExtracting && changeQuality("low"),
    "import:quality:medium": () =>
      videoName && !isExtracting && changeQuality("medium"),
    "import:quality:high": () =>
      videoName && !isExtracting && changeQuality("high"),
  });

  return (
    <Popover name="import" title="Import">
      {/* video input button */}
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        onClick={() => document.getElementById("video-input").click()}
      >
        Upload Video (U)
      </button>

      {/* frame folder path input */}
      <input
        ref={pathRef}
        type="text"
        placeholder="Absolute Path (P)"
        id="folder-path-input"
        style={{ width: "100%", boxSizing: "border-box" }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") loadFrameFolder(e.target.value.trim());
          if (e.key === "Escape") e.target.blur();
        }}
      />

      {/* import .xml file */}
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={() => document.getElementById("import-xml-input").click()}
      >
        Import XML (X)
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
          {["low", "medium", "high"].map((q, i) => (
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
              {q.charAt(0).toUpperCase() + q.slice(1)} ({i + 1})
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export default ImportPopover;
