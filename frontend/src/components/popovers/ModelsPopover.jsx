import useStore from "../../store";
import { THEME } from "../../constants";
import Popover from "../Popover";
import Tooltip from "../Tooltip";
import usePopoverKeys from "../../usePopoverKeys";

function ModelsPopover() {
  const {
    yoloConf,
    matchThresh,
    maxLost,
    videoName,
    isRunningYolo,
    isExtracting,
    isPolygonTightening,
    isBoxTightening,
    embeddingStatus,
    samPolygonTighten,
    samBoxTighten,
    runYolo,
    runTrackingWithReId,
    computeEmbeddings,
  } = useStore((s) => s);

  const busy = !videoName || isRunningYolo || isExtracting;
  usePopoverKeys({
    "models:yolo": () => !busy && runYolo(),
    "models:embeddings": () =>
      videoName &&
      embeddingStatus !== "computing" &&
      computeEmbeddings(embeddingStatus === "ready"),
    "models:track": () => !busy && runTrackingWithReId(),
    "models:tighten": () => videoName && !isBoxTightening && samBoxTighten(),
    "models:polygon": () =>
      videoName && !isPolygonTightening && samPolygonTighten(),
  });

  return (
    <Popover name="models" title="Models">
      {/* confidence level slider */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 4,
        }}
      >
        <Tooltip text="low = more boxes, high = fewer boxes">
          <label style={{ fontSize: 11, width: 50, flexShrink: 0 }}>
            Conf: {yoloConf}
          </label>
        </Tooltip>
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.05}
          value={yoloConf}
          onChange={(e) =>
            useStore.setState({ yoloConf: parseFloat(e.target.value) })
          }
          style={{ flex: 1, accentColor: THEME.accent, width: "100%" }}
        />
      </div>
      {/* match threshold slider */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 4,
        }}
      >
        <Tooltip text="higher = stricter match. lower = more lenient">
          <label style={{ fontSize: 11, width: 50, flexShrink: 0 }}>
            Match: {matchThresh}
          </label>
        </Tooltip>
        <input
          type="range"
          min={0.1}
          max={0.9}
          step={0.05}
          value={matchThresh}
          onChange={(e) =>
            useStore.setState({ matchThresh: parseFloat(e.target.value) })
          }
          style={{ flex: 1, accentColor: THEME.accent, width: "100%" }}
        />
      </div>

      {/* max lost slider */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 4,
        }}
      >
        <Tooltip text="higher = keeps ID through long gaps. lower = drops track fast">
          <label style={{ fontSize: 11, width: 50, flexShrink: 0 }}>
            Max lost: {maxLost}f
          </label>
        </Tooltip>
        <input
          type="range"
          min={60}
          max={120}
          step={5}
          value={maxLost}
          onChange={(e) =>
            useStore.setState({ maxLost: parseInt(e.target.value) })
          }
          style={{ flex: 1, accentColor: THEME.accent, width: "100%" }}
        />
      </div>
      {/* run yolo button */}
      <Tooltip text="model auto draws every box">
        <button
          style={{ width: "100%" }}
          tabIndex={-1}
          disabled={!videoName || isRunningYolo || isExtracting}
          onClick={runYolo}
        >
          {isRunningYolo ? "Running…" : "Run YOLOv7-tiny (Y)"}
        </button>
      </Tooltip>
      {/* compute embeddings */}
      <Tooltip text="model memorises each box's look">
        <button
          style={{ width: "100%", marginTop: 4 }}
          tabIndex={-1}
          disabled={!videoName || embeddingStatus === "computing"}
          onClick={() => computeEmbeddings(embeddingStatus === "ready")} // force=true if recomputing
        >
          {embeddingStatus === "computing"
            ? "Computing..."
            : embeddingStatus === "ready"
              ? "Recompute Embeddings (E)"
              : "Compute Embeddings (E)"}
        </button>
      </Tooltip>
      {/* run bytetrack with visual re-id */}
      <Tooltip text="track every object, give ID to each object">
        <button
          style={{ width: "100%", marginTop: 4 }}
          tabIndex={-1}
          disabled={!videoName || isRunningYolo || isExtracting}
          onClick={runTrackingWithReId}
        >
          {isRunningYolo ? "Running…" : "Run Tracking + Re-ID (T)"}
        </button>
      </Tooltip>
      {/* run fastsam to snap every box in this frame to a tightened rect */}
      <Tooltip text="loose boxes snap tight to edges">
        <button
          style={{ width: "100%", marginTop: 4 }}
          tabIndex={-1}
          disabled={!videoName || isBoxTightening}
          onClick={() => samBoxTighten()}
        >
          {isBoxTightening ? "Tightening…" : "Run FastSAM Tighten Boxes (B)"}
        </button>
      </Tooltip>
      {/* run fastsam to snap every box in this frame into a polygon */}
      <Tooltip text="box becomes exact outline">
        <button
          style={{ width: "100%", marginTop: 4 }}
          tabIndex={-1}
          disabled={!videoName || isPolygonTightening}
          onClick={() => samPolygonTighten()}
        >
          {isPolygonTightening ? "Tightening…" : "Run FastSAM Polygon (P)"}
        </button>
      </Tooltip>
    </Popover>
  );
}

export default ModelsPopover;
