import { useRef, useEffect } from "react";
import useStore from "../../store";
import { THEME } from "../../constants";
import Popover from "../Popover";
import Tooltip from "../Tooltip";
import usePopoverKeys from "../../usePopoverKeys";

function ImportPopover() {
  const {
    videoName,
    quality,
    isExtracting,
    busy,
    loadFrameFolder,
    changeQuality,
    ui,
    videoList,
    isLoadingVideos,
    listVideos,
    openVideo,
    setPopover,
  } = useStore((s) => s);
  const pathRef = useRef(null);
  const listRef = useRef(null);

  const isOpen = ui.openPopover === "import";

  useEffect(() => {
    if (isOpen) listVideos();
  }, [isOpen, videoName]);

  usePopoverKeys({
    "import:upload": () =>
      !busy && document.getElementById("video-input").click(),
    "import:videos": () =>
      listRef.current?.querySelector("button:not([disabled])")?.focus(),
    "import:xml": () => {
      if (videoName && !busy)
        document.getElementById("import-xml-input").click();
    },
    "import:path": () => pathRef.current?.focus(),
    // quality re-extracts frames, so it needs a loaded video
    "import:quality:low": () =>
      videoName && !isExtracting && !busy && changeQuality("low"),
    "import:quality:medium": () =>
      videoName && !isExtracting && !busy && changeQuality("medium"),
    "import:quality:high": () =>
      videoName && !isExtracting && !busy && changeQuality("high"),
  });

  // arrow keys to navigate the video list
  const handleListKeys = (e) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    const rows = Array.from(
      listRef.current?.querySelectorAll("button:not([disabled])") ?? [],
    );
    if (rows.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const i = rows.indexOf(document.activeElement);
    let next = 0;
    if (e.key === "ArrowDown")
      next = i < 0 ? 0 : Math.min(i + 1, rows.length - 1);
    if (e.key === "ArrowUp") next = i < 0 ? 0 : Math.max(i - 1, 0);
    if (e.key === "End") next = rows.length - 1;
    rows[next].focus();
  };

  const formatDuration = (frames, fps) => {
    if (!frames || !fps) return "unknown length";
    const total = Math.round(frames / fps);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const videos = videoList ?? [];

  return (
    <Popover name="import" title="Import" center>
      <div
        style={{
          width: 340,
          maxWidth: "90vw",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 0,
        }}
      >
        {/* pinned upload buttons */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {/* video input button */}
          <button
            style={{ width: "100%" }}
            tabIndex={-1}
            disabled={!!busy}
            onClick={() => document.getElementById("video-input").click()}
          >
            Upload Video (U)
          </button>

          {/* frame folder path input */}
          <Tooltip text="load a folder of images instead of a video">
            <input
              ref={pathRef}
              type="text"
              placeholder="Folder Path (P)"
              id="folder-path-input"
              disabled={!!busy}
              style={{ width: "100%", boxSizing: "border-box" }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") loadFrameFolder(e.target.value.trim());
                if (e.key === "Escape") e.target.blur();
              }}
            />
          </Tooltip>

          {/* import .xml file */}
          <Tooltip text="load boxes from a CVAT file">
            <button
              style={{ width: "100%" }}
              tabIndex={-1}
              disabled={!videoName || !!busy}
              onClick={() =>
                document.getElementById("import-xml-input").click()
              }
            >
              Import XML (X)
            </button>
          </Tooltip>

          {/* frame quality toggle */}
          {videoName && (
            <div
              style={{
                borderTop: `1px solid ${THEME.divider}`,
                paddingTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <h4 style={{ margin: 0, fontSize: 13 }}>Quality</h4>
              {["low", "medium", "high"].map((q, i) => (
                <Tooltip key={q} text="change image quality">
                  <button
                    tabIndex={-1}
                    disabled={isExtracting || !!busy}
                    onClick={() => changeQuality(q)}
                    style={{
                      flex: 1,
                      fontWeight: quality === q ? "bold" : "normal",
                      background: quality === q ? THEME.accent : "",
                      color: quality === q ? THEME.text : "",
                      padding: "4px",
                    }}
                  >
                    {q.charAt(0).toUpperCase() + q.slice(1)} ({i + 1})
                  </button>
                </Tooltip>
              ))}
            </div>
          )}
        </div>

        {/* previously imported videos (V) */}
        <div
          style={{
            borderTop: `1px solid ${THEME.divider}`,
            paddingTop: 8,
            flexShrink: 0,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <h4 style={{ margin: 0, fontSize: 13 }}>Videos (V)</h4>
          <span style={{ color: THEME.faint, fontSize: 10 }}>
            {videos.length > 0 ? `${videos.length} imported` : ""}
          </span>
        </div>

        <div
          ref={listRef}
          onKeyDown={handleListKeys}
          style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {isLoadingVideos && videos.length === 0 ? (
            <p style={{ color: THEME.label, margin: 0, fontSize: 12 }}>
              Loading videos...
            </p>
          ) : videos.length === 0 ? (
            <p style={{ color: THEME.label, margin: 0, fontSize: 12 }}>
              No videos imported yet.
            </p>
          ) : (
            videos.map((v) => {
              const isCurrent = v.video_name === videoName;
              return (
                <button
                  key={v.video_name}
                  disabled={isExtracting || isCurrent || !!busy}
                  onClick={async () => {
                    await openVideo(v.video_name);
                    setPopover(null);
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 2,
                    padding: "6px 8px",
                    borderRadius: THEME.radius,
                    border: "none",
                    width: "100%",
                    textAlign: "left",
                    color: THEME.text,
                    cursor: isCurrent ? "default" : "pointer",
                    background: isCurrent ? THEME.accent : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrent)
                      e.currentTarget.style.background = THEME.hover;
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span style={{ fontWeight: "bold", fontSize: 13 }}>
                    {v.video_name}
                    {isCurrent ? " (open)" : ""}
                  </span>
                  <span style={{ color: THEME.label, fontSize: 11 }}>
                    {v.frame_count} frames · {v.bbox_count} bboxes ·{" "}
                    {formatDuration(v.frame_count, v.frame_rate)}
                  </span>
                  <span style={{ color: THEME.faint, fontSize: 10 }}>
                    Saved:{" "}
                    {v.saved_at
                      ? new Date(v.saved_at).toLocaleString()
                      : "never"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Popover>
  );
}

export default ImportPopover;
