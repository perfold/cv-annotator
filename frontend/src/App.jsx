import { useEffect, useState } from "react"
import axios from "axios"

function App() {
  
  // create variables and setters
  const [videoName, setVideoName] = useState(null)
  const [frameCount, setFrameCount] = useState(null)
  const [currentFrame, setCurrentFrame] = useState(0)

  // upload video function
  async function uploadVideo(file) {
    const formData = new FormData()
    formData.append("file", file)

    const res = await axios.post("http://localhost:8000/upload-video", formData)
    setVideoName(res.data.video_name)
    setFrameCount(res.data.frame_count)
    setCurrentFrame(0)
  }

  function prevFrame() {
    setCurrentFrame(f => Math.max(0, f - 1))
  }

  function nextFrame() {
    setCurrentFrame(f => Math.min(frameCount - 1, f + 1))
  }

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
        </div>
      )}
    </div>
  )
}

export default App