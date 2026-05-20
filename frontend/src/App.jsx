import { useEffect, useState, useRef } from "react"
import axios from "axios"
import AnnotationCanvas from "./AnnotationCanvas"

// global constants
const PALETTE = [ // anotations will be auto assigned one of these colors
'#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
'#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#ff5722',
'#8bc34a', '#673ab7', '#ff9800', '#009688', '#cddc39'
]
const DEFAULT_TAGS = ['occluded', 'blur', 'cut-off', 'image-error'] // default tags


function App() {
  
  // create variables and setters
  const [videoName, setVideoName] = useState(null)
  const [frameCount, setFrameCount] = useState(null)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [fps, setFps] = useState(30)
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef(null)
  const [frameInterval, setFrameInterval] = useState(10) // user definable keyframe interval, 10 is default

  // class labels
  const [classes, setClasses] = useState([]) // list of existing classes
  const [newClassName, setNewClassName] = useState("") // temporary, to hold half-typed labels
  const [activeClass, setActiveClass] = useState(null) // currently selected class
  const [classColors, setClassColors] = useState({}) // custom colors for the classes

  // bbox states
  const [bboxesByFrame, setBboxesByFrame] = useState({}) // stores dict of frame:list of bbox
  const frameBboxes = bboxesByFrame[currentFrame] ?? []
  const [selectedBboxId, setSelectedBboxId] = useState(null) // handles tracking of selected bbox, to change classes
  const [contextMenu, setContextMenu] = useState(null) // where to render floating menu, and for which bbox

  // bbox tags
  const [tags, setTags] = useState(DEFAULT_TAGS) 
  const [newTagName, setNewTagName] = useState('') // used to add custom tags for the bboxes

  // format time into HH:MM:SS
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }

  // upload video function
  async function uploadVideo(file) {
    const formData = new FormData()
    formData.append("file", file)

    const res = await axios.post("http://localhost:8000/upload-video", formData)
    setVideoName(res.data.video_name)
    setFrameCount(res.data.frame_count)
    setFps(res.data.frame_rate)
    setCurrentFrame(0)
    setBboxesByFrame({})
  }

  // frame navigation
  function prevFrame() {
    setCurrentFrame(f => Math.max(0, f - 1))
  }

  function nextFrame() {
    setCurrentFrame(f => Math.min(frameCount - 1, f + 1))
  }

  // keyboard controls
  useEffect(() => {
    if (!videoName) return
    function handleKeyDown(e) {
      if (e.key === "ArrowLeft") prevFrame() // regular 1 frame skip
      if (e.key === "ArrowRight") nextFrame()
      if (e.key === ",") setCurrentFrame(f => Math.max(0, f - frameInterval)) // keyframe interval skip
      if (e.key === ".") setCurrentFrame(f => Math.min(frameCount - 1, f + frameInterval)) // mapped to unshifted < > keys
      if (e.key === " ") {
        e.preventDefault() // to prevent spacebar from triggering file explorer directly after video upload
        setIsPlaying(p => !p)
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBboxId) { // ddelete bbox if selected + hit backspace/del
        e.preventDefault()
        deleteBbox(selectedBboxId)
        setSelectedBboxId(null)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [videoName, frameCount, frameInterval, selectedBboxId])

  // video playback
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentFrame(f => {
          if (f >= frameCount - 1) {
            setIsPlaying(false)
            return f
          }
          return f + 1
        })
      }, 1000 / fps) 
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [isPlaying, frameCount])

  // class label functions
  function addClass() {
    const trimmed = newClassName.trim()
    if (!trimmed || classes.includes(trimmed)) return
    const color = PALETTE[classes.length % PALETTE.length]
    setClasses(c => [...c, trimmed])
    setClassColors(prev => ({ ...prev, [trimmed]: color }))
    setNewClassName("")
  }

  function deleteClass(className) {
    setClasses(c => c.filter(c => c !== className))
    setClassColors(prev => {
      const next = { ...prev }
      delete next[className]
      return next
    })
    if (activeClass === className) setActiveClass(null)
  }

  // bbox drawing functions
  function addBbox(bbox) {
    setBboxesByFrame(prev => ({
      ...prev,
      [currentFrame]: [...(prev[currentFrame] ?? []), { tags: [], ...bbox }]
    }))
  }

  function deleteBbox(id) { // select bbox + backspace/del to use
    setBboxesByFrame(prev => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).filter(b => b.id !== id)
    }))
  }

  // bbox class changing functions
  function changeClass(id, newClassName) {
    setBboxesByFrame(prev => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).map(b =>
        b.id === id ? { ...b, className: newClassName } : b
      )
    }))
  }

  function openContextMenu(x, y, bboxId) {
    setContextMenu({ x, y, bboxId })
  }

  useEffect(() => {
    if (!contextMenu) return
    const close = () => { setContextMenu(null); setSelectedBboxId(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  // bbox tagging functions
  function addTag() {
      const trimmed = newTagName.trim()
      if (!trimmed || tags.includes(trimmed)) return // ignore if 'new' tag already in list
      setTags(t => [...t, trimmed])
      setNewTagName('')
    }

    function deleteTag(tagName) {
      setTags(t => t.filter(t => t !== tagName))
      setBboxesByFrame(prev => { // also remove it from any bbox that has it
        const next = {}
        for (const [frame, bboxes] of Object.entries(prev)) {
          next[frame] = bboxes.map(b => ({
            ...b,
            tags: (b.tags ?? []).filter(t => t !== tagName)
          }))
        }
        return next
      })
    }

    function toggleBboxTag(bboxId, tagName) {
      setBboxesByFrame(prev => ({
        ...prev,
        [currentFrame]: (prev[currentFrame] ?? []).map(b => {
          if (b.id !== bboxId) return b
          const has = (b.tags ?? []).includes(tagName)
          return { ...b, tags: has 
            ? b.tags.filter(t => t !== tagName) // remove tag if bbox already has it
            : [...(b.tags ?? []), tagName] } // add tag if don't have yet
        })
      }))
    }

// UI block
return (
  <div style={{ display: "flex", height: "100vh", textAlign: "center" }}>

    {/* left sidebar: class list */}
    <div style={{ width: "20%", borderRight: "1px solid #ccc", padding: "8px" }}>
      <h3>Classes</h3>
      <p>Active class: {activeClass ?? "N/A"}</p> {/* shows selected class */}
      <input
        type="text"
        value={newClassName}
        onChange={(e) => setNewClassName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") addClass() }}
        placeholder="Enter new class"
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <button onClick={addClass}>Add</button>  {/* button to add new class */}
      <ul>
        {classes.map(className => (
          <li
            key={className}
            onClick={() => setActiveClass(className)}
            style={{
              fontWeight: activeClass === className ? "bold" : "normal",
              backgroundColor: activeClass === className ? "#750000" : "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: 'center',
              gap: "6px",
              padding: "2px 4px"
            }}
          >
            <input
              type="color"
              value={classColors[className] ?? '#ffffff'}
              onChange={(e) => setClassColors(prev => ({ ...prev, [className]: e.target.value }))} // lets you pick which colour you want
              onClick={(e) => e.stopPropagation()}
              style={{ width: 20, height: 20, border: 'none', padding: 0, cursor: 'pointer' }}
            />
            {className}
            <button onClick={(e) => { e.stopPropagation(); deleteClass(className) }}>x</button>
          </li>
        ))}
      </ul>

      {/* tag list */}
      <div style={{ borderTop: '1px solid #ccc', marginTop: 8, paddingTop: 8 }}>
        <h3>Tags</h3>
        {!selectedBboxId && <p style={{ color: '#888', fontSize: 12 }}>Select a bbox to apply tags.</p>}
        <input
          type="text"
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTag() }}
          placeholder="Add new tag"
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        <button onClick={addTag}>Add</button>
        <ul style={{ textAlign: 'left', padding: '0 4px', listStyle: 'none' }}>
          {tags.map(tag => {
            const selectedBbox = frameBboxes.find(b => b.id === selectedBboxId)
            const isChecked = selectedBbox ? (selectedBbox.tags ?? []).includes(tag) : false
            return (
              <li key={tag} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={!selectedBboxId}
                  onChange={() => toggleBboxTag(selectedBboxId, tag)}
                />
                <span style={{
                  background: '#750000',
                  color: '#FFFFFF',
                  borderRadius: 3,
                  padding: '1px 5px',
                  fontSize: 11
                }}>
                  {tag}
                </span>
                <button onClick={() => deleteTag(tag)} style={{ marginLeft: 'auto' }}>x</button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>

    {/* center area: video + controls */}
    <div style={{ flex: 1, padding: "8px", display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: 'center'
    }}>
      <input
        type="file"
        accept="video/*"
        onChange={(e) => uploadVideo(e.target.files[0])}
      />
      {videoName && (
        <div style={{width: '100%'}}>
          <p>Loaded: {videoName} ({frameCount} frames)</p> {/* shows total frame ct */}
          <AnnotationCanvas
            frameUrl={`http://localhost:8000/frame/${videoName}/${currentFrame}`}
            activeClass={activeClass}
            classColors={classColors}
            frameBboxes={frameBboxes}
            addBbox={addBbox}
            selectedBboxId={selectedBboxId}
            setSelectedBboxId={setSelectedBboxId}
            openContextMenu={openContextMenu}
          /> {/* calls fastAPI for image */}
          <div>
            <button onClick={() => setCurrentFrame(f => Math.max(0, f - frameInterval))} disabled={currentFrame === 0}>{"<<"}</button> {/* interval back */}
            <button onClick={prevFrame} disabled={currentFrame === 0}>{"<"}</button> {/* back button */}
            <span> Frame {currentFrame + 1} / {frameCount} </span>
            <button onClick={nextFrame} disabled={currentFrame === frameCount - 1}>{">"}</button> {/* forward button */}
            <button onClick={() => setCurrentFrame(f => Math.min(frameCount - 1, f + frameInterval))} disabled={currentFrame === frameCount - 1}>{">>"}  </button> {/* interval forward */}
          </div>
          <div>
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button onClick={() => setIsPlaying(p => !p)}> {/* play/pause button */}
              {isPlaying ? "Pause" : "Play"}
            </button> {/* slider */}
            <input
              type="range"
              min={0}
              max={frameCount - 1}
              value={currentFrame}
              onChange={(e) => setCurrentFrame(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#750000" }}
            />
            <span>{formatTime(currentFrame / fps)} / {formatTime(frameCount / fps)}</span>
          </div>
        </div>
      )}
    </div>

    {/* right sidebar: annotations */}
    <div style={{ width: "20%", borderLeft: "1px solid #ccc", padding: "8px" }}>
        <h3>Annotations</h3>
        {frameBboxes.length === 0 ? (
          <p style={{ color: "#aaa" }}>No annotations yet.</p>
        ) : (
          <ul style={{ textAlign: "left", padding: "0 16px" }}>
            {frameBboxes.map((b, i) => (
              <li 
                key={b.id} 
                title={b.id}
                onContextMenu={(e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, b.id) }}
                style={{ background: selectedBboxId === b.id ? '#333' : 'transparent' }}
              >
                {i + 1}. {b.className} <span style={{ color: '#888', fontSize: 11 }}>#{b.id.slice(0, 6)}</span>
                {(b.tags ?? []).map(tag => (
                  <span key={tag} style={{
                    background: '#750000',
                    color: '#FFFFFF',
                    borderRadius: 3,
                    padding: '1px 5px',
                    fontSize: 10,
                    marginLeft: 3
                  }}>
                    {tag}
                  </span>
                ))}
                <button onClick={() => deleteBbox(b.id)} style={{ marginLeft: 4 }}>x</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    
    {/* context menu */}
    {contextMenu && (
    <div style={{
        position: 'fixed',
        top: contextMenu.y,
        left: contextMenu.x,
        background: '#1a1a1a',
        border: '1px solid #555',
        borderRadius: 4,
        zIndex: 1000,
        minWidth: 140,
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
      }}
    onClick={e => e.stopPropagation()}  // prevent closing when clicking inside menu
  >
    <div style={{ padding: '4px 10px', color: '#888', fontSize: 11, borderBottom: '1px solid #333' }}>
      Change class:
    </div>
    {classes.map(cls => (
      <div
        key={cls}
        onClick={() => { changeClass(contextMenu.bboxId, cls); setContextMenu(null) }}
        style={{
          padding: '6px 12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#333'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ width: 10, height: 10, borderRadius: 2, background: classColors[cls] ?? '#fff', display: 'inline-block' }} />
        {cls}
      </div>
    ))}
    <div style={{ borderTop: '1px solid #333', borderBottom: '1px solid #333' }}>
      <div style={{ padding: '4px 10px', color: '#888', fontSize: 11 }}>Tags:</div>
      {tags.map(tag => {
        const bbox = frameBboxes.find(b => b.id === contextMenu.bboxId)
        const isChecked = bbox ? (bbox.tags ?? []).includes(tag) : false
        return (
          <div
            key={tag}
            onClick={() => toggleBboxTag(contextMenu.bboxId, tag)}
            style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = '#333'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <input type="checkbox" checked={isChecked} onChange={() => {}} style={{ pointerEvents: 'none' }} />
            {tag}
          </div>
        )
      })}
    </div>
    <div style={{ borderTop: '1px solid #333' }}>
      <div
        onClick={() => { deleteBbox(contextMenu.bboxId); setContextMenu(null) }}
        style={{ padding: '6px 12px', cursor: 'pointer', color: '#e74c3c' }}
        onMouseEnter={e => e.currentTarget.style.background = '#333'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        Delete
      </div>
    </div>
  </div>
)}
    </div>
  )
}

export default App