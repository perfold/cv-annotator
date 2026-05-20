import { useEffect, useState, useRef } from "react"
import axios from "axios"
import AnnotationCanvas from "./AnnotationCanvas"

function App() {
  
  // create variables and setters
  const [videoName, setVideoName] = useState(null)
  const [frameCount, setFrameCount] = useState(null)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [fps, setFps] = useState(30)
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef(null)
  const [frameInterval, setFrameInterval] = useState(10) // user definable keyframe interval

  // class labels
  const [classes, setClasses] = useState([]) // list of existing classes
  const [newClassName, setNewClassName] = useState("") // temporary, to hold half-typed labels
  const [activeClass, setActiveClass] = useState(null) // currently selected class

  // bbox states
  const [bboxesByFrame, setBboxesByFrame] = useState({}) // stores dict of frame:list of bbox
  const frameBboxes = bboxesByFrame[currentFrame] ?? []

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
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [videoName, frameCount, frameInterval])

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
    setClasses(c => [...c, trimmed])
    setNewClassName("")
  }

  function deleteClass(className) {
    setClasses(c => c.filter(c => c !== className))
    if (activeClass === className) setActiveClass(null)
  }

  // bbox drawing functions
  function addBbox(bbox) {
    setBboxesByFrame(prev => ({
      ...prev,
      [currentFrame]: [...(prev[currentFrame] ?? []), bbox]
    }))
  }

  function deleteBbox(id) {
    setBboxesByFrame(prev => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).filter(b => b.id !== id)
    }))
  }

// UI block
return (
  <div style={{ display: "flex", height: "100vh", textAlign: "center" }}>

    {/* left sidebar: class list */}
    <div style={{ width: "200px", borderRight: "1px solid #ccc", padding: "8px" }}>
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
              cursor: "pointer"
            }}
          > {/* select class on click */}
            {className}
            <button onClick={(e) => { e.stopPropagation(); deleteClass(className) }}>x</button>
          </li>
        ))}
      </ul>
    </div>

    {/* center area: video + controls */}
    <div style={{ flex: 1, padding: "8px", display: "flex", flexDirection: "column", alignItems: "center"}}>
      <input
        type="file"
        accept="video/*"
        onChange={(e) => uploadVideo(e.target.files[0])}
      />
      {videoName && (
        <div style={{ width: '85%' }}>
          <p>Loaded: {videoName} ({frameCount} frames)</p> {/* shows total frame ct */}
          <AnnotationCanvas
            frameUrl={`http://localhost:8000/frame/${videoName}/${currentFrame}`}
            activeClass={activeClass}
            classes={classes}
            frameBboxes={frameBboxes}
            addBbox={addBbox}
            deleteBbox={deleteBbox}
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

    {/* right sidebar: annotations (placeholder for future feature) */}
    <div style={{ width: "200px", borderLeft: "1px solid #ccc", padding: "8px" }}>
        <h3>Annotations</h3>
        {frameBboxes.length === 0 ? (
          <p style={{ color: "#aaa" }}>No annotations yet.</p>
        ) : (
          <ul style={{ textAlign: "left", padding: "0 16px" }}>
            {frameBboxes.map((b, i) => (
              <li key={b.id} title={b.id}>   {/* shows id */}
                {i + 1}. {b.className} <span style={{ color: '#888', fontSize: 11 }}>#{b.id.slice(0, 6)}</span>
                <button onClick={() => deleteBbox(b.id)} style={{ marginLeft: 4 }}>x</button>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  )
}

export default App