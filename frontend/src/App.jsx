import { useEffect, useState } from "react"
import axios from "axios"

// to test if the React front end can talk to the FastAPI backend
function App() {
  const [status, setStatus] = useState("checking...")

  useEffect(() => {
    axios.get("http://localhost:8000/health")
      .then(res => setStatus(res.data.status))
      .catch(() => setStatus("cannot reach backend"))
  }, [])

  return <div>Backend status: {status}</div>
}

export default App