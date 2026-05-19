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
      if (e.key === " ") setIsPlaying(p => !p)
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

  // UI block
  return (
    <div>
      <input 
        type="file"
        accept="video/*"
        onChange={(e) => uploadVideo(e.target.files[0])}
      />
      {videoName && (
        <div>
          <p>Loaded: {videoName} ({frameCount} frames)</p> {/* shows total frame ct */}
          <img src={`http://localhost:8000/frame/${videoName}/${currentFrame}`} /> {/* calls fastAPI for image */}
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
  )
}

export default App