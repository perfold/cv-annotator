import { Stage, Layer, Image as KonvaImage, Rect, Text, Group, Label, Tag } from 'react-konva'
import useImage from 'use-image'
import { useState, useRef, useEffect } from 'react'

function AnnotationCanvas({ frameUrl, activeClass, classColors, frameBboxes, addBbox, selectedBboxIds, setSelectedBboxIds, openContextMenu, mode, updateBboxes}) {
    
  // refs and states
  const containerRef = useRef()
  const [containerWidth, setContainerWidth] = useState(0)
  const nodeRefs = useRef({})             
  const dragStartPositions = useRef({}) // positions at drag start
  const rubberBandStartRef = useRef(null) // where rubber band started
  const rubberBandFiredRef = useRef(false) // prevent onClick deselect after rubber band
  const [rubberBand, setRubberBand] = useState(null) // rubber band dimensions
  const [stageScale, setStageScale] = useState(1) // to allow for zoom in/out
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0 }) // handle panning around stage
  const stageStartPosRef = useRef({ x: 0, y: 0 })
  const justPannedRef = useRef(false) // prevent ctrl drag from drawing bbox

  useEffect(() => {
    if (!containerRef.current) return
    setContainerWidth(containerRef.current.getBoundingClientRect().width)
    
    const observer = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width)
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const [image, status] = useImage(frameUrl, 'anonymous')

  // keep the previous frame visible while the next one loads, prevent 'flickering' effect
  const lastImageRef = useRef(null)
  if (status === 'loaded') lastImageRef.current = image
  const displayImage = lastImageRef.current  

  // scale stage to fit image naturally
  const MAX_STAGE_HEIGHT = window.innerHeight - 205  // keep space for buttons above/below stage
  let stageWidth = containerWidth
  let scale = displayImage && stageWidth ? stageWidth / displayImage.naturalWidth : 1
  let stageHeight = displayImage ? displayImage.naturalHeight * scale : 0

  if (displayImage && stageHeight > MAX_STAGE_HEIGHT) {
    scale = MAX_STAGE_HEIGHT / displayImage.naturalHeight
    stageHeight = MAX_STAGE_HEIGHT
    stageWidth = displayImage.naturalWidth * scale
  }

  // drawing state
  const [drawStart, setDrawStart]   = useState(null) // top left corner of bbox
  const [drawCurrent, setDrawCurrent] = useState(null) // continuously updated as bbox size changes
  const isDrawing = drawStart !== null

  const stageRef = useRef()

  const getPointerPos = () => {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    const scale = stage.scaleX()
    return {
      x: (pos.x - stagePos.x) / scale,
      y: (pos.y - stagePos.y) / scale,
    }
  }

  const rectFromPoints = (a, b) => ({
    x:      Math.min(a.x, b.x),
    y:      Math.min(a.y, b.y),
    width:  Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  })

  const rectsIntersect = (a, rb) =>
  !(a.x + a.width < rb.x || a.x > rb.x + rb.width ||
    a.y + a.height < rb.y || a.y > rb.y + rb.height)

  const handleClick = (e) => {
    if (justPannedRef.current) { justPannedRef.current = false; return } // if just pan, don't draw bbox
    if (e.evt.button === 2) {setSelectedBboxIds([]); return}  // ensure right click doesnt trigger new bbox, only used to open context menu
    if (rubberBandFiredRef.current) { rubberBandFiredRef.current = false; return } // prevent click after rubberband
    if (mode === 'select') { // in select mode, clicking on canvas deselects bbox
      setSelectedBboxIds([])
      return
    }
    setSelectedBboxIds([])
    if (!activeClass) return
    if (isDrawing) return // ignore the second click if current drawing
    const pos = getPointerPos()
    if (!pos) return
    setDrawStart(pos)
    setDrawCurrent(pos)
  }

  const handleMouseMove = (e) => {
    if (isPanningRef.current) {
      const stage = e.target.getStage()
      const ptr = stage.getPointerPosition()
      const dx = ptr.x - panStartRef.current.x
      const dy = ptr.y - panStartRef.current.y
      stage.position({
        x: stageStartPosRef.current.x + dx,
        y: stageStartPosRef.current.y + dy,
      })
      return
    }

    // basic draw logic
    if (isDrawing) {
      const pos = getPointerPos()
      if (pos) setDrawCurrent(pos)
      return
    }
    // rubber band logic
    if (mode === 'select' && rubberBandStartRef.current) {
      const pos = getPointerPos()
      if (!pos) return
      const start = rubberBandStartRef.current
      if (Math.abs(pos.x - start.x) > 3 || Math.abs(pos.y - start.y) > 3) {
        setRubberBand({ x1: start.x, y1: start.y, x2: pos.x, y2: pos.y })
      }
    }
  }

  const handleMouseDown = (e) => {
    const isMiddle = e.evt.button === 1
    const isCtrlPan = e.evt.ctrlKey && e.evt.button === 0

    if (isMiddle || isCtrlPan) {
      e.evt.preventDefault()
      isPanningRef.current = true
      const stage = e.target.getStage()
      const ptr = stage.getPointerPosition()
      panStartRef.current = { x: ptr.x, y: ptr.y } // pan around stage
      stageStartPosRef.current = { x: stage.x(), y: stage.y() }
      return  // don't start drawing
    }
    if (mode !== 'select') return
    if (e.evt.button !== 0) return
    const pos = getPointerPos()
    rubberBandStartRef.current = pos
  }

  const handleMouseUp = (e) => {
    if (isPanningRef.current) {
      isPanningRef.current = false
      justPannedRef.current = true // to prevent drawing of bbox when release pan
      return
    }

    if (!rubberBand) { rubberBandStartRef.current = null; return }
    const rb = {
      x: Math.min(rubberBand.x1, rubberBand.x2),
      y: Math.min(rubberBand.y1, rubberBand.y2),
      width: Math.abs(rubberBand.x2 - rubberBand.x1),
      height: Math.abs(rubberBand.y2 - rubberBand.y1),
    }
    const intersecting = frameBboxes.filter(b => rectsIntersect(b, rb)).map(b => b.id)
    if (intersecting.length > 0) {
      setSelectedBboxIds(intersecting)
      rubberBandFiredRef.current = true // block the upcoming onClick from deselecting
    }
    setRubberBand(null)
    rubberBandStartRef.current = null
  }

  const handleDblClick = (e) => {
    if (mode === 'select') { 
      setStageScale(1) // zooms back to original scale if you double click
      setStagePos({ x: 0, y: 0 })
      return
    }
    if (!isDrawing || !drawCurrent) return
    const rect = rectFromPoints(drawStart, drawCurrent)

    if (rect.width > 5 && rect.height > 5) {
      addBbox({ id: crypto.randomUUID(), className: activeClass, ...rect })
    }

    setDrawStart(null)
    setDrawCurrent(null)
  }

    const handleWheel = (e) => {
      e.evt.preventDefault()
      const stage = stageRef.current
      const pointer = stage.getPointerPosition()
      const zoomFactor = 1.08
      const newScale = e.evt.deltaY < 0 ? stageScale * zoomFactor : stageScale / zoomFactor
      const clampedScale = Math.min(Math.max(newScale, 1), 10)

      if (clampedScale === 1) {
        setStageScale(1)
        setStagePos({ x: 0, y: 0 })
        return
      }

      const mousePointTo = {
        x: (pointer.x - stagePos.x) / stageScale,
        y: (pointer.y - stagePos.y) / stageScale,
      }
      setStagePos({
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      })
      setStageScale(clampedScale)
    }

  const preview = isDrawing && drawCurrent
    ? rectFromPoints(drawStart, drawCurrent)
    : null

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', overflow: 'hidden'}}>    
      {mode === 'draw' && !activeClass && ( // hides 'select class to start annotating' if in select mode
        <p style={{ color: '#750000', margin: '4px 0' }}>
          Select a class to start annotating.
        </p>
      )}
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        style={{ 
          cursor: mode === 'draw' ? (isDrawing ? 'crosshair' : 'crosshair') : 'default', 
          display: 'block' 
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
            <KonvaImage image={displayImage} width={stageWidth} height={stageHeight} />
          )}

          {frameBboxes.map((b) => {
            const color = classColors[b.className] ?? '#ffffff'
            const isSelected = selectedBboxIds.includes(b.id)
            return (
              <Group
                key={b.id}
                x={b.x} y={b.y}
                ref={el => { if (el) nodeRefs.current[b.id] = el; else delete nodeRefs.current[b.id] }}
                // bbox dragging functions
                draggable={mode === 'select'}
                listening={mode === 'select'}
                onMouseDown={(e) => {
                  if (e.evt.ctrlKey) return  
                  e.cancelBubble = true
                }}
                onDragStart={(e) => {
                  if (e.evt.ctrlKey) { e.target.stopDrag(); return } // prevent dragging of bbox when panning/dragging image
                  e.cancelBubble = true
                  // if dragging an unselected box, select only it
                  const currentSelection = selectedBboxIds.includes(b.id) ? selectedBboxIds : [b.id]
                  if (!selectedBboxIds.includes(b.id)) setSelectedBboxIds([b.id])
                  // record start positions for all selected boxes
                  dragStartPositions.current = {}
                  currentSelection.forEach(id => {
                    const node = nodeRefs.current[id]
                    if (node) dragStartPositions.current[id] = { x: node.x(), y: node.y() }
                  })
                }}
                onDragMove={(e) => {
                  e.cancelBubble = true
                  const start = dragStartPositions.current[b.id]
                  if (!start) return
                  const dx = e.target.x() - start.x
                  const dy = e.target.y() - start.y
                  // move all other selected boxes together
                  selectedBboxIds.forEach(id => {
                    if (id === b.id) return
                    const node = nodeRefs.current[id]
                    const s = dragStartPositions.current[id]
                    if (node && s) { node.x(s.x + dx); node.y(s.y + dy) }
                  })
                }}
                onDragEnd={(e) => {
                  e.cancelBubble = true
                  // batch update all selected boxes with their final positions
                  const updates = selectedBboxIds.map(id => {
                    const node = nodeRefs.current[id]
                    return node ? { id, x: node.x(), y: node.y() } : null
                  }).filter(Boolean)
                  updateBboxes(updates)
                  dragStartPositions.current = {}
                }}
                onClick={(e) => {
                  if (mode !== 'select') return
                  e.cancelBubble = true
                  if (e.evt.shiftKey) {
                    // shift+click: toggle this box in/out of selection
                    setSelectedBboxIds(prev =>
                      prev.includes(b.id) ? prev.filter(id => id !== b.id) : [...prev, b.id]
                    )
                  } else {
                    // left click, no shift: select only this box
                    setSelectedBboxIds([b.id])
                  }
                }}
                onContextMenu={(e) => {
                  e.evt.preventDefault()
                  e.cancelBubble = true
                  setSelectedBboxIds([b.id])
                  openContextMenu(e.evt.clientX, e.evt.clientY, b.id)
                }}
                onMouseEnter={(e) => {
                  if (mode === 'select') e.target.getStage().container().style.cursor = 'move'
                }}
                onMouseLeave={(e) => {
                  e.target.getStage().container().style.cursor = mode === 'draw' ? 'crosshair' : 'default'
                }}
              >
                {/* bbox settings */}
                <Rect
                  x={0} y={0}
                  width={b.width} 
                  height={b.height}
                  stroke={color}
                  strokeWidth={isSelected ? 6 : 2} // thickens line when box is highlighted
                  fill={color + '25'} // intensity of bbox fill colour
                />
                {/* class:id tag above bbox */}
                <Label x={0} y={-20}> 
                  <Tag fill='white' />
                  <Text
                    text={`${b.className}: ${b.id.slice(0, 6)}`}
                    fontSize={10}
                    fill='#000000'
                    padding={3}
                  />
                </Label>
              </Group>
            )
          })}

          {preview && (
            <Rect
              x={preview.x} y={preview.y}
              width={preview.width} height={preview.height}
              stroke='#ffffff'
              strokeWidth={1}
              dash={[6, 3]}
              fill='rgba(255,255,255,0.08)'
              listening={false}
            />
          )}
          {rubberBand && (
            <Rect
              x={Math.min(rubberBand.x1, rubberBand.x2)}
              y={Math.min(rubberBand.y1, rubberBand.y2)}
              width={Math.abs(rubberBand.x2 - rubberBand.x1)}
              height={Math.abs(rubberBand.y2 - rubberBand.y1)}
              stroke='#4af'
              strokeWidth={1}
              dash={[4, 4]}
              fill='rgba(64,170,255,0.08)'
              listening={false}
            />
          )}
        </Layer>
      </Stage>
    </div>
  )
}

export default AnnotationCanvas