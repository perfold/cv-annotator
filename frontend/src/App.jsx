import { useEffect, useState } from "react"
import axios from "axios"

function App() {
  
  // create variables and setters
  const [videoName, setVideoName] = useState(null)
  const [frameCount, setFrameCount] = useState(null)

  // upload video function
  async function uploadVideo(file) {
    const formData = new FormData()
    formData.append("file", file)

    const res = await axios.post("http://localhost:8000/upload-video", formData)
    setVideoName(res.data.video_name)
    setFrameCount(res.data.frame_count)
  }

  // ui for the upload video button
  return (
    <div>
      <input
        type="file"
        accept="video/*"
        onChange={(e) => uploadVideo(e.target.files[0])}
      />
      {videoName && <p>Loaded: {videoName} ({frameCount} frames)</p>}
    </div>
  )
}


export default App