import { THEME } from "../constants";
import useStore from "../store";
import Tooltip from "./Tooltip";

function VideoScrubber({ formatTime, prevFrame, nextFrame }) {
  const {
    currentFrame,
    frameCount,
    frameStart,
    frameInterval,
    isPlaying,
    isExtracting,
    fps,
    outliers,
    OUTLIER_COLOR,
  } = useStore((s) => s);

  const OUTLIER_COLOR_VAL = THEME.outlierTick;

  return (
    <>
      <div>
        {/* playback navigation */}
        <button
          tabIndex={-1}
          onClick={() =>
            useStore.setState({
              currentFrame: Math.max(0, currentFrame - frameInterval),
            })
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
          Frame {currentFrame + frameStart} / {frameCount + frameStart - 1}{" "}
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
            useStore.setState({
              currentFrame: Math.min(
                frameCount - 1,
                currentFrame + frameInterval,
              ),
            })
          }
          disabled={currentFrame === frameCount - 1 || isExtracting}
        >
          {">>"}{" "}
        </button>{" "}
        {/* interval forward */}
      </div>
      <div>
        {/* frame interval setter */}
        <Tooltip text="jumps this many frames per click">
          <label>Interval: </label>
        </Tooltip>
        <input
          type="number"
          value={frameInterval}
          min={1}
          onChange={(e) =>
            useStore.setState({ frameInterval: Number(e.target.value) })
          }
          style={{ width: "50px" }}
        />
        <span> frames</span>
      </div>
      {/* play/pause button */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          tabIndex={-1}
          onClick={() => useStore.setState({ isPlaying: !isPlaying })}
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
              onClick={() => useStore.setState({ currentFrame: o.frame_idx })}
              style={{
                position: "absolute",
                left: `${(o.frame_idx / (frameCount - 1)) * 100}%`,
                top: 0,
                width: 3,
                height: "100%",
                background: OUTLIER_COLOR_VAL,
                opacity: 0.8,
                cursor: "pointer",
                zIndex: 1,
                transform: "translateX(-50%)",
              }}
              title={`${o.timestamp} — ${o.class} (${
                o.reason === "rare_class"
                  ? "⚠ rare class"
                  : "⚠ visually different"
              } — ${o.detail})`}
            />
          ))}
          <input
            type="range"
            min={0}
            max={frameCount - 1}
            value={currentFrame}
            onChange={(e) =>
              useStore.setState({ currentFrame: Number(e.target.value) })
            }
            style={{
              width: "100%",
              accentColor: THEME.accent,
              position: "relative",
              zIndex: 2,
            }}
            disabled={isExtracting}
          />
        </div>
        <span>
          {formatTime(currentFrame / fps)} / {formatTime(frameCount / fps)}
        </span>
      </div>
    </>
  );
}

export default VideoScrubber;
