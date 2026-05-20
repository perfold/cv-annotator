import { Stage, Layer, Image as KonvaImage, Rect, Text } from 'react-konva'
import useImage from 'use-image'
import { useState, useRef, useEffect } from 'react'

function AnnotationCanvas({ frameUrl, activeClass, classColors, frameBboxes, addBbox, selectedBboxId, setSelectedBboxId, openContextMenu}) {
    
  // make stage size self-adjusting to the screen size
  const containerRef = useRef()
  const [containerWidth, setContainerWidth] = useState(0)
  
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

  const getPointerPos = () => stageRef.current?.getPointerPosition() ?? null

  const rectFromPoints = (a, b) => ({
    x:      Math.min(a.x, b.x),
    y:      Math.min(a.y, b.y),
    width:  Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  })

  const handleClick = (e) => {
    if (e.evt.button === 2) {setSelectedBboxId(null); return}  // ensure right click doesnt trigger new bbox, only used to change class
    if (!activeClass) return
    if (isDrawing) return // ignore the second click if current drawing
    const pos = getPointerPos()
    if (!pos) return
    setDrawStart(pos)
    setDrawCurrent(pos)
  }

  const handleMouseMove = () => {
    if (!isDrawing) return
    const pos = getPointerPos()
    if (pos) setDrawCurrent(pos)
  }

  const handleDblClick = () => {
    if (!isDrawing || !drawCurrent) return
    const rect = rectFromPoints(drawStart, drawCurrent)

    if (rect.width > 5 && rect.height > 5) {
      addBbox({ id: crypto.randomUUID(), className: activeClass, ...rect })
    }

    setDrawStart(null)
    setDrawCurrent(null)
  }

  const preview = isDrawing && drawCurrent
    ? rectFromPoints(drawStart, drawCurrent)
    : null

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>      {!activeClass && (
        <p style={{ color: '#750000', margin: '4px 0' }}>
          Select a class to start annotating.
        </p>
      )}
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
        style={{ cursor: isDrawing ? 'crosshair' : 'default', display: 'block'}}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onDblClick={handleDblClick}
      >
        <Layer>
          {displayImage && (
            <KonvaImage image={displayImage} width={stageWidth} height={stageHeight} />
          )}

          {frameBboxes.map((b) => {
            const color = classColors[b.className] ?? '#ffffff'
            const isSelected = b.id === selectedBboxId
            return (
              <Rect
                key={b.id}
                x={b.x} y={b.y}
                width={b.width} height={b.height}
                stroke= {color}
                strokeWidth={isSelected ? 6 : 2} // thickens line when box is highlighted
                fill={color + '25'} // intensity of bbox fill colour
                onClick={(e) => {
                    e.cancelBubble = true // prevent trigger of new bbox if selecting existing bbox
                    setSelectedBboxId(b.id)
                }}
                onContextMenu={(e) => { 
                    e.evt.preventDefault()   
                    e.cancelBubble = true
                    setSelectedBboxId(b.id)
                    openContextMenu(e.evt.clientX, e.evt.clientY, b.id)
                }}
              />
            )
          })}

          {frameBboxes.map((b) => (
            <Text
              key={b.id + '_lbl'}
              x={b.x + 4} y={b.y + 4}
              text={`${b.className}: ${b.id.slice(0, 6)}`}
              fontSize={12}
              fill={classColors[b.className] ?? '#ffffff'}
              listening={false}
            />
          ))}

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
        </Layer>
      </Stage>
    </div>
  )
}

export default AnnotationCanvas