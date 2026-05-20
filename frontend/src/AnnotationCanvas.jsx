import { Stage, Layer, Image as KonvaImage, Rect, Text } from 'react-konva'
import useImage from 'use-image'
import { useState, useRef, useEffect } from 'react'

const CLASS_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#e91e63',
]

// assign a consistent color per class name
function classColor(className, classes) {
  const idx = classes.indexOf(className)
  return CLASS_COLORS[idx % CLASS_COLORS.length]
}

function AnnotationCanvas({ frameUrl, activeClass, classes, frameBboxes, addBbox, deleteBbox }) {
  
  // make stage size self-adjusting to the screen size
  const containerRef = useRef()
  const [containerWidth, setContainerWidth] = useState(0)
  
  useEffect(() => {
  if (!containerRef.current) return
  setContainerWidth(containerRef.current.getBoundingClientRect().width) // measure immediately on mount
  
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
  const stageWidth = displayImage ? Math.min(containerWidth, displayImage.naturalWidth) : containerWidth
  const scale = displayImage ? stageWidth / displayImage.naturalWidth : 1
  const stageHeight = displayImage ? displayImage.naturalHeight * scale : 480

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

  const handleClick = () => {
    if (!activeClass) return
    if (isDrawing) return       // ignore the second click if current drawing
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
    <div ref={containerRef} style={{ width: '100%', margin: '0 auto' }}>      {!activeClass && (
        <p style={{ color: '#750000', margin: '4px 0' }}>
          Select a class to start annotating.
        </p>
      )}
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
        style={{ cursor: isDrawing ? 'crosshair' : 'default', display: 'block' }}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onDblClick={handleDblClick}
      >
        <Layer>
          {displayImage && (
            <KonvaImage image={displayImage} width={stageWidth} height={stageHeight} />
          )}

          {frameBboxes.map((b) => {
            const color = classColor(b.className, classes)
            return (
              <Rect
                key={b.id}
                x={b.x} y={b.y}
                width={b.width} height={b.height}
                stroke={color}
                strokeWidth={2}
                fill={color + '22'}
                onDblClick={(e) => {   // double-click a bbox to delete it
                  e.cancelBubble = true
                  deleteBbox(b.id)
                }}
              />
            )
          })}

          {frameBboxes.map((b) => (
            <Text
              key={b.id + '_lbl'}
              x={b.x + 4} y={b.y + 4}
              text={b.className}
              fontSize={12}
              fill={classColor(b.className, classes)}
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