function VideoScrubber({
  currentFrame,
  frameCount,
  frameInterval,
  setFrameInterval,
  setCurrentFrame,
  prevFrame,
  nextFrame,
  isPlaying,
  setIsPlaying,
  isExtracting,
  fps,
  outliers,
  OUTLIER_COLOR,
  formatTime,
}) {
  return (
    <>
      {/* calls fastAPI for image */}
      <div>
        {/* playback navigation */}
        <button
          tabIndex={-1}
          onClick={() =>
            setCurrentFrame((f) => Math.max(0, f - frameInterval))
          }
          disabled={currentFrame === 0 || isExtracting}
        >
          {"<<"}
        </button>{" "}
        {/* interval back */}
        <button
          tabIndex={-1}
          onClick={prevFrame}
          disabled={currentFrame === 0 || isExtracting}
        >
          {"<"}
        </button>{" "}
        {/* back button */}
        <span>
          {" "}
          Frame {currentFrame + 1} / {frameCount}{" "}
        </span>
        <button
          tabIndex={-1}
          onClick={nextFrame}
          disabled={currentFrame === frameCount - 1 || isExtracting}
        >
          {">"}
        </button>{" "}
        {/* forward button */}
        <button
          tabIndex={-1}
          onClick={() =>
            setCurrentFrame((f) =>
              Math.min(frameCount - 1, f + frameInterval),
            )
          }
          disabled={currentFrame === frameCount - 1 || isExtracting}
        >
          {">>"}{" "}
        </button>{" "}
        {/* interval forward */}
      </div>
      <div>
        {/* frame interval setter */}
        <label>Interval: </label>
        <input
          type="number"
          value={frameInterval}
          min={1}
          onChange={(e) => setFrameInterval(Number(e.target.value))}
          style={{ width: "50px" }}
        />
        <span> frames</span>
      </div>
      {/* play/pause button */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          tabIndex={-1}
          onClick={() => setIsPlaying((p) => !p)}
          disabled={isExtracting}
        >
          {isPlaying ? "Pause" : "Play"}
          {/* video slider */}
        </button>
        {/* video slider with outlier markers */}
        <div style={{ flex: 1, position: "relative" }}>
          {/* outlier tick marks */}
          {outliers.map((o, i) => (
            <div
              key={i}
              onClick={() => setCurrentFrame(o.frame_idx)}
              style={{
                position: "absolute",
                left: `${(o.frame_idx / (frameCount - 1)) * 100}%`,
                top: 0,
                width: 3,
                height: "100%",
                background: OUTLIER_COLOR,
                opacity: 0.8,
                cursor: "pointer",
                zIndex: 1,
                transform: "translateX(-50%)",
              }}
              title={`${o.timestamp} — ${o.class} (${
                o.reason === "orientation"
                  ? "⚠ wrong orientation"
                  : o.reason === "aspect_ratio"
                    ? "⚠ unusual shape"
                    : "⚠ rare class"
              } — {o.detail})`}
            />
          ))}
          <input
            type="range"
            min={0}
            max={frameCount - 1}
            value={currentFrame}
            onChange={(e) => setCurrentFrame(Number(e.target.value))}
            style={{
              width: "100%",
              accentColor: "#750000",
              position: "relative",
              zIndex: 2,
            }}
            disabled={isExtracting}
          />
        </div>
        <span>
          {formatTime(currentFrame / fps)} /{" "}
          {formatTime(frameCount / fps)}
        </span>
      </div>
    </>
  );
}

export default VideoScrubber;
