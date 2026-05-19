import { useEffect, useState, useRef } from "react"
import axios from "axios"

function App() {
  
  // create variables and setters
  const [videoName, setVideoName] = useState(null)
  const [frameCount, setFrameCount] = useState(null)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [fps, setFps] = useState(30)
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef(null)


  // class labels
  const [classes, setClasses] = useState([]) // list of existing classes
  const [newClassName, setNewClassName] = useState("") // temporary, to hold half-typed labels
  const [activeClass, setActiveClass] = useState(null) // currently selected class

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
      if (e.key === "ArrowLeft") prevFrame()
      if (e.key === "ArrowRight") nextFrame()
      if (e.key === " ") {
        e.preventDefault() // to prevent spacebar from triggering file explorer directly after video upload
        setIsPlaying(p => !p)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [videoName, frameCount])

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
        placeholder="Enter new class name here"
      />
      <button onClick={addClass}>Add</button>  {/* button to add new class */}
      <ul>
        {classes.map(className => (
          <li
            key={className}
            onClick={() => setActiveClass(className)} 
            style={{ fontWeight: activeClass === className ? "bold" : "normal", cursor: "pointer" }}
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
        <div>
          <p>Loaded: {videoName} ({frameCount} frames)</p> {/* shows total frame ct */}
          <img 
            src={`http://localhost:8000/frame/${videoName}/${currentFrame}`}
            style={{ maxHeight: "85vh", width: "auto"}}
          /> {/* calls fastAPI for image */}
          <div>
            <button onClick={prevFrame} disabled={currentFrame === 0}>Prev</button> {/* back button */}
            <span> Frame {currentFrame + 1} / {frameCount} </span>
            <button onClick={nextFrame} disabled={currentFrame === frameCount - 1}>Next</button> {/* forward button */}
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
              style={{ flex: 1 }}
            />
            <span>{formatTime(currentFrame / fps)} / {formatTime(frameCount / fps)}</span>
          </div>
        </div>
      )}
    </div>

    {/* right sidebar: annotations (placeholder for future feature) */}
    <div style={{ width: "200px", borderLeft: "1px solid #ccc", padding: "8px" }}>
      <h3>Annotations</h3>
      <p style={{ color: "#aaa" }}>No annotations yet.</p>
    </div>

  </div>
)
}

export default App