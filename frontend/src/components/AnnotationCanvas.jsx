import {
  Stage,
  Layer,
  Image as KonvaImage,
  Rect,
  Line,
  Text,
  Group,
  Label,
  Tag,
  Transformer,
} from "react-konva";
import useImage from "use-image";
import { useState, useRef, useEffect } from "react";
import { OUTLIER_COLOR, FA_COLOR, THEME } from "../constants";

function AnnotationCanvas({
  frameUrl,
  activeClass,
  classColors,
  frameBboxes,
  addBbox,
  selectedBboxIds,
  setSelectedBboxIds,
  openContextMenu,
  mode,
  updateBboxes,
  onDimsReady,
  outlierBboxIds,
  outlierColor = OUTLIER_COLOR,
  hideAllBboxes = false,
  showOnlyFlagged = false,
}) {
  // refs and states
  const containerRef = useRef();
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const nodeRefs = useRef({});
  const dragStartPositions = useRef({}); // positions at drag start
  const rubberBandStartRef = useRef(null); // where rubber band started
  const rubberBandFiredRef = useRef(false); // prevent onClick deselect after rubber band
  const [rubberBand, setRubberBand] = useState(null); // rubber band dimensions
  const [stageScale, setStageScale] = useState(1); // to allow for zoom in/out
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 }); // handle panning around stage
  const stageStartPosRef = useRef({ x: 0, y: 0 });
  const justPannedRef = useRef(false); // prevent ctrl drag from drawing bbox
  const [resizingId, setResizingId] = useState(null); // to manage resizing of bboxes
  const transformerRef = useRef();

  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setContainerWidth(rect.width);
    setContainerHeight(rect.height);

    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
      setContainerHeight(entries[0].contentRect.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // cancel bbox drawing using Esc, zoom out using 0
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setDrawStart(null);
        setDrawCurrent(null);
      }
      if (e.key === "0" && !e.ctrlKey && !e.metaKey) {
        const t = e.target;
        const typing =
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable);
        if (typing) return;
        resetView();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  const [image, status] = useImage(frameUrl, "anonymous");

  // keep the previous frame visible while the next one loads, prevent 'flickering' effect
  const lastImageRef = useRef(null);
  if (status === "loaded") lastImageRef.current = image;
  const displayImage = lastImageRef.current;

  // scale stage to fit image naturally
  const MAX_STAGE_HEIGHT = Math.max(200, containerHeight);
  let stageWidth = containerWidth;
  let scale =
    displayImage && stageWidth ? stageWidth / displayImage.naturalWidth : 1;
  let stageHeight = displayImage ? displayImage.naturalHeight * scale : 0;

  if (displayImage && stageHeight > MAX_STAGE_HEIGHT) {
    scale = MAX_STAGE_HEIGHT / displayImage.naturalHeight;
    stageHeight = MAX_STAGE_HEIGHT;
    stageWidth = displayImage.naturalWidth * scale;
  }

  useEffect(() => {
    if (!displayImage) return;
    onDimsReady?.({
      origW: displayImage.naturalWidth,
      origH: displayImage.naturalHeight,
      dispW: stageWidth,
      dispH: stageHeight,
    });
  }, [displayImage, stageWidth, stageHeight]);

  // resize bbox
  useEffect(() => {
    if (!transformerRef.current) return;
    if (!resizingId) {
      transformerRef.current.nodes([]);
      return;
    }
    const node = nodeRefs.current[resizingId];
    if (node) {
      transformerRef.current.nodes([node]);
      transformerRef.current.getLayer().batchDraw();
    }
  }, [resizingId]);

  // drawing state
  const [drawStart, setDrawStart] = useState(null); // top left corner of bbox
  const [drawCurrent, setDrawCurrent] = useState(null); // continuously updated as bbox size changes
  const isDrawing = drawStart !== null;

  const stageRef = useRef();

  const getPointerPos = () => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    const zoom = stage.scaleX();
    // boxes are stored in image space
    return {
      x: (pos.x - stage.x()) / zoom / scale,
      y: (pos.y - stage.y()) / zoom / scale,
    };
  };

  const resetView = () => {
    setStageScale(1);
    setStagePos({ x: 0, y: 0 });
    const stage = stageRef.current;
    if (stage) {
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      stage.batchDraw();
    }
  };

  const rectFromPoints = (a, b) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  const rectsIntersect = (a, rb) =>
    !(
      a.x + a.width < rb.x ||
      a.x > rb.x + rb.width ||
      a.y + a.height < rb.y ||
      a.y > rb.y + rb.height
    );

  const handleClick = (e) => {
    setResizingId(null); // for resizing of bboxes
    if (justPannedRef.current) {
      justPannedRef.current = false;
      return;
    } // if just pan, don't draw bbox
    if (e.evt.button === 2) {
      setSelectedBboxIds([]);
      return;
    } // ensure right click doesnt trigger new bbox, only used to open context menu
    if (rubberBandFiredRef.current) {
      rubberBandFiredRef.current = false;
      return;
    } // prevent click after rubberband
    if (mode === "select") {
      // in select mode, clicking on canvas deselects bbox
      setSelectedBboxIds([]);
      return;
    }
    setSelectedBboxIds([]);
    if (!activeClass) return;
    if (isDrawing) return; // ignore the second click if current drawing
    const pos = getPointerPos();
    if (!pos) return;
    setDrawStart(pos);
    setDrawCurrent(pos);
  };

  const handleMouseMove = (e) => {
    if (isPanningRef.current) {
      const stage = e.target.getStage();
      const ptr = stage.getPointerPosition();
      const dx = ptr.x - panStartRef.current.x;
      const dy = ptr.y - panStartRef.current.y;
      stage.position({
        x: stageStartPosRef.current.x + dx,
        y: stageStartPosRef.current.y + dy,
      });
      return;
    }

    // basic draw logic
    if (isDrawing) {
      const pos = getPointerPos();
      if (pos) setDrawCurrent(pos);
      return;
    }
    // rubber band logic
    if (mode === "select" && rubberBandStartRef.current) {
      const pos = getPointerPos();
      if (!pos) return;
      const start = rubberBandStartRef.current;
      if (Math.abs(pos.x - start.x) > 3 || Math.abs(pos.y - start.y) > 3) {
        setRubberBand({ x1: start.x, y1: start.y, x2: pos.x, y2: pos.y });
      }
    }
  };

  const handleMouseDown = (e) => {
    const isMiddle = e.evt.button === 1;
    const isCtrlPan = e.evt.ctrlKey && e.evt.button === 0;

    if (isMiddle || isCtrlPan) {
      e.evt.preventDefault();
      isPanningRef.current = true;
      const stage = e.target.getStage();
      const ptr = stage.getPointerPosition();
      panStartRef.current = { x: ptr.x, y: ptr.y }; // pan around stage
      stageStartPosRef.current = { x: stage.x(), y: stage.y() };
      return; // don't start drawing
    }
    if (mode !== "select") return;
    if (e.evt.button !== 0) return;
    const pos = getPointerPos();
    rubberBandStartRef.current = pos;
  };

  const handleMouseUp = (e) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      justPannedRef.current = true; // to prevent drawing of bbox when release pan
      const stage = stageRef.current;
      if (stage) setStagePos({ x: stage.x(), y: stage.y() });
      return;
    }

    if (!rubberBand) {
      rubberBandStartRef.current = null;
      return;
    }
    const rb = {
      x: Math.min(rubberBand.x1, rubberBand.x2),
      y: Math.min(rubberBand.y1, rubberBand.y2),
      width: Math.abs(rubberBand.x2 - rubberBand.x1),
      height: Math.abs(rubberBand.y2 - rubberBand.y1),
    };
    const intersecting = frameBboxes
      .filter((b) => rectsIntersect(b, rb))
      .map((b) => b.id);
    if (intersecting.length > 0) {
      setSelectedBboxIds(intersecting);
      rubberBandFiredRef.current = true; // block the upcoming onClick from deselecting
    }
    setRubberBand(null);
    rubberBandStartRef.current = null;
  };

  const handleDblClick = (e) => {
    if (mode === "select") {
      setResizingId(null);
      return;
    }
    if (!isDrawing || !drawCurrent) return;
    const rect = rectFromPoints(drawStart, drawCurrent);

    if (rect.width > 5 && rect.height > 5) {
      addBbox({ id: crypto.randomUUID(), className: activeClass, ...rect });
    }

    setDrawStart(null);
    setDrawCurrent(null);
  };

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage.getPointerPosition();
    const zoomFactor = 1.08;
    const newScale =
      e.evt.deltaY < 0 ? stageScale * zoomFactor : stageScale / zoomFactor;
    const clampedScale = Math.min(Math.max(newScale, 1), 10);

    if (clampedScale === 1) {
      resetView();
      return;
    }

    const mousePointTo = {
      x: (pointer.x - stage.x()) / stage.scaleX(),
      y: (pointer.y - stage.y()) / stage.scaleX(),
    };

    setStagePos({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    });
    setStageScale(clampedScale);
  };

  const preview =
    isDrawing && drawCurrent ? rectFromPoints(drawStart, drawCurrent) : null;
  const invZoom = 1 / (scale * stageScale); // scaling factor to keep object the same size even if you zoom in

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
        overflow: "hidden",
      }}
    >
      {mode === "draw" &&
        !activeClass && ( // hides 'select class to start annotating' if in select mode
          <p style={{ color: THEME.accent, margin: "4px 0" }}>
            Select a class to start annotating.
          </p>
        )}
      <div style={{ width: stageWidth, height: stageHeight, flexShrink: 0 }}>
        <Stage
          ref={stageRef}
          width={stageWidth}
          height={stageHeight}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          style={{
            cursor:
              mode === "draw"
                ? isDrawing
                  ? "crosshair"
                  : "crosshair"
                : "default",
            display: "block",
          }}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDblClick={handleDblClick}
          onWheel={handleWheel}
        >
          <Layer>
            {displayImage && (
              <KonvaImage
                image={displayImage}
                width={stageWidth}
                height={stageHeight}
              />
            )}

            {frameBboxes
              .filter((b) => {
                if (hideAllBboxes) return false;
                if (!showOnlyFlagged) return true;
                // filter on: keep only boxes that are a live outlier, carry the outlier tag, or have the false-alarm class
                const t = b.tags ?? [];
                return (
                  outlierBboxIds?.includes(b.id) ||
                  t.includes("outlier") ||
                  b.className === "false-alarm"
                );
              })
              .map((b) => {
                const isFa = b.className === "false-alarm";
                const color = isFa
                  ? FA_COLOR
                  : (classColors[b.className] ?? "#ffffff");
                const isSelected = selectedBboxIds.includes(b.id);
                return (
                  <Group
                    key={b.id}
                    x={b.x * scale}
                    y={b.y * scale}
                    scaleX={scale}
                    scaleY={scale}
                    ref={(el) => {
                      if (el) nodeRefs.current[b.id] = el;
                      else delete nodeRefs.current[b.id];
                    }}
                    // bbox dragging functions
                    draggable={mode === "select" && resizingId !== b.id}
                    listening={mode === "select"}
                    onMouseDown={(e) => {
                      if (e.evt.ctrlKey) return;
                      e.cancelBubble = true;
                    }}
                    onDragStart={(e) => {
                      if (e.evt.ctrlKey) {
                        e.target.stopDrag();
                        return;
                      } // prevent dragging of bbox when panning/dragging image
                      e.cancelBubble = true;
                      // if dragging an unselected box, select only it
                      const currentSelection = selectedBboxIds.includes(b.id)
                        ? selectedBboxIds
                        : [b.id];
                      if (!selectedBboxIds.includes(b.id))
                        setSelectedBboxIds([b.id]);
                      // record start positions for all selected boxes
                      dragStartPositions.current = {};
                      currentSelection.forEach((id) => {
                        const node = nodeRefs.current[id];
                        if (node)
                          dragStartPositions.current[id] = {
                            x: node.x(),
                            y: node.y(),
                          };
                      });
                    }}
                    onDragMove={(e) => {
                      e.cancelBubble = true;
                      const start = dragStartPositions.current[b.id];
                      if (!start) return;
                      const dx = e.target.x() - start.x;
                      const dy = e.target.y() - start.y;
                      // move all other selected boxes together
                      selectedBboxIds.forEach((id) => {
                        if (id === b.id) return;
                        const node = nodeRefs.current[id];
                        const s = dragStartPositions.current[id];
                        if (node && s) {
                          node.x(s.x + dx);
                          node.y(s.y + dy);
                        }
                      });
                    }}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                      // batch update all selected boxes with their final positions
                      const updates = selectedBboxIds
                        .map((id) => {
                          const node = nodeRefs.current[id];
                          // node coords are stage space, divide back to image space
                          return node
                            ? { id, x: node.x() / scale, y: node.y() / scale }
                            : null;
                        })
                        .filter(Boolean);
                      updateBboxes(updates);
                      dragStartPositions.current = {};
                    }}
                    onClick={(e) => {
                      if (mode !== "select") return;
                      e.cancelBubble = true;
                      if (e.evt.shiftKey) {
                        setSelectedBboxIds(
                          selectedBboxIds.includes(b.id)
                            ? selectedBboxIds.filter((id) => id !== b.id)
                            : [...selectedBboxIds, b.id],
                        );
                      } else {
                        // left click, no shift: select only this box
                        setSelectedBboxIds([b.id]);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.evt.preventDefault();
                      e.cancelBubble = true;
                      setSelectedBboxIds([b.id]);
                      openContextMenu(e.evt.clientX, e.evt.clientY, b.id);
                    }}
                    onMouseEnter={(e) => {
                      if (mode === "select")
                        e.target.getStage().container().style.cursor = "move";
                    }}
                    onMouseLeave={(e) => {
                      e.target.getStage().container().style.cursor =
                        mode === "draw" ? "crosshair" : "default";
                    }}
                    onDblClick={(e) => {
                      if (mode !== "select") return;
                      e.cancelBubble = true;
                      setResizingId(b.id);
                    }}
                  >
                    {/* bbox */}
                    {!(b.polygon && b.polygon.length > 0) && (
                      <Rect
                        x={0}
                        y={0}
                        width={b.width}
                        height={b.height}
                        stroke={
                          outlierBboxIds?.includes(b.id) ? outlierColor : color
                        }
                        strokeWidth={isSelected ? 4 : 2} // thickens line when box is highlighted
                        strokeScaleEnabled={false}
                        fill={
                          (outlierBboxIds?.includes(b.id)
                            ? outlierColor
                            : color) + (isFa ? "55" : "25") // denser fill for fa so it reads as struck out
                        }
                      />
                    )}
                    {/* sam segmentation polygon */}
                    {b.polygon && b.polygon.length > 0 && (
                      <Line
                        points={b.polygon.flat()}
                        closed
                        stroke={
                          outlierBboxIds?.includes(b.id) ? outlierColor : color
                        }
                        strokeWidth={isSelected ? 4 : 2}
                        strokeScaleEnabled={false}
                        fill={
                          (outlierBboxIds?.includes(b.id)
                            ? outlierColor
                            : color) + (isFa ? "55" : "25")
                        }
                      />
                    )}
                    {/* fa cross */}
                    {isFa && (
                      <>
                        <Line
                          points={[0, 0, b.width, b.height]}
                          stroke={
                            outlierBboxIds?.includes(b.id)
                              ? outlierColor
                              : color
                          }
                          strokeWidth={2}
                          strokeScaleEnabled={false}
                          listening={false}
                        />
                        <Line
                          points={[b.width, 0, 0, b.height]}
                          stroke={
                            outlierBboxIds?.includes(b.id)
                              ? outlierColor
                              : color
                          }
                          strokeWidth={2}
                          strokeScaleEnabled={false}
                          listening={false}
                        />
                      </>
                    )}
                    {/* class tag above bbox */}
                    <Label
                      x={0}
                      y={-20 * invZoom}
                      scaleX={invZoom}
                      scaleY={invZoom}
                    >
                      <Tag fill="white" />
                      <Text
                        text={
                          b.trackId !== null && b.trackId !== undefined
                            ? `${b.className}: #${b.trackId}`
                            : b.className
                        }
                        fontSize={10}
                        fill="#000000"
                        padding={3}
                      />
                    </Label>
                  </Group>
                );
              })}

            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              keepRatio={false}
              anchorSize={8 / stageScale}
              anchorStrokeWidth={1 / stageScale}
              borderStrokeWidth={1 / stageScale}
              ignoreStroke
              onTransformEnd={() => {
                if (!resizingId) return;
                const node = nodeRefs.current[resizingId];
                if (!node) return;
                const bbox = frameBboxes.find((b) => b.id === resizingId);
                if (!bbox) return;

                const ratioX = node.scaleX() / scale;
                const ratioY = node.scaleY() / scale;
                node.scaleX(scale); // apply the resize to width/height instead
                node.scaleY(scale);

                updateBboxes([
                  {
                    id: resizingId,
                    x: node.x() / scale, // node coords are stage space
                    y: node.y() / scale,
                    width: Math.max(5, bbox.width * ratioX),
                    height: Math.max(5, bbox.height * ratioY),
                  },
                ]);
              }}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 5 || newBox.height < 5) return oldBox; // prevent resize too small
                return newBox;
              }}
            />

            {/* preview rect */}
            {preview && (
              <Rect
                x={preview.x * scale}
                y={preview.y * scale}
                width={preview.width * scale}
                height={preview.height * scale}
                stroke="#ffffff"
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[6, 3]}
                fill="rgba(255,255,255,0.08)"
                listening={false}
              />
            )}
            {rubberBand && (
              <Rect
                x={Math.min(rubberBand.x1, rubberBand.x2) * scale}
                y={Math.min(rubberBand.y1, rubberBand.y2) * scale}
                width={Math.abs(rubberBand.x2 - rubberBand.x1) * scale}
                height={Math.abs(rubberBand.y2 - rubberBand.y1) * scale}
                stroke={THEME.border}
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[4, 4]}
                fill="rgba(64,170,255,0.08)"
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

export default AnnotationCanvas;
