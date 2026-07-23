import { useRef } from "react";
import useStore from "../../store";
import Popover from "../Popover";
import usePopoverKeys from "../../usePopoverKeys";

// note: the hidden file inputs these buttons click live in App.jsx, not here.
// the popover unmounts when closed, so an input mounted inside it would be gone
// by the time getElementById ran
function ImportPopover() {
  const { videoName, quality, isExtracting, loadFrameFolder, changeQuality } =
    useStore((s) => s);
  const pathRef = useRef(null);

  // scoped keys, only live while this popover is open. the action strings match
  // POPOVER_KEYS.import in keymap.js
  usePopoverKeys({
    "import:upload": () => document.getElementById("video-input").click(),
    "import:xml": () => {
      if (videoName) document.getElementById("import-xml-input").click();
    },
    // p focuses the path box rather than doing anything, so the flow is i then p
    // then type. the hotkey handler ignores keys from inputs, so typing is safe
    "import:path": () => pathRef.current?.focus(),
    "import:quality:low": () => !isExtracting && changeQuality("low"),
    "import:quality:medium": () => !isExtracting && changeQuality("medium"),
    "import:quality:high": () => !isExtracting && changeQuality("high"),
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
          if (e.key === "Escape") e.target.blur(); // hand keys back to the popover
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

      {/* frame quality toggle. lives here because changing it re-extracts frames,
          which is an import-side operation */}
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
