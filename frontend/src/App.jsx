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

const QUALITY_PRESETS = { low: 31, medium: 15, high: 1 } // extracted frames' jpg quality

// save and load annotations from data folder
async function saveSession(videoName, bboxesByFrame, classes, classColors) {
  await axios.post(`http://localhost:8000/save/${videoName}`, {
    bboxesByFrame, classes, classColors,
    savedAt: new Date().toISOString()
  })
}

async function loadSession(videoName) {
  const res = await axios.get(`http://localhost:8000/load/${videoName}`)
  return Object.keys(res.data).length > 0 ? res.data : null
}

function App() {
  
  // create variables and setters
  const [videoName, setVideoName] = useState(null)
  const [frameCount, setFrameCount] = useState(null)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [fps, setFps] = useState(30)
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef(null)
  const [frameInterval, setFrameInterval] = useState(10) // user definable keyframe interval, 10 is default
  const [mode, setMode] = useState('select') // toggle between select and draw mode 
  const [showSaved, setShowSaved] = useState(false)
  const lastSavedRef = useRef(null)
  const imageDimsRef = useRef({ origW: 0, origH: 0, dispW: 0, dispH: 0 })
  const [quality, setQuality] = useState('low') // set quality of extracted frames, default low
  const [isExtracting, setIsExtracting] = useState(false) 

  // class labels
  const [classes, setClasses] = useState([]) // list of existing classes
  const [newClassName, setNewClassName] = useState("") // temporary, to hold half-typed labels
  const [activeClass, setActiveClass] = useState(null) // currently selected class
  const [classColors, setClassColors] = useState({}) // custom colors for the classes

  // bbox states
  const [bboxesByFrame, setBboxesByFrame] = useState({}) // stores dict of frame:list of bbox
  const frameBboxes = bboxesByFrame[currentFrame] ?? []
  const [selectedBboxIds, setSelectedBboxIds] = useState([]) // handles tracking of selected bboxes, to change classes/drag
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
    formData.append("quality", QUALITY_PRESETS[quality])

    const res = await axios.post("http://localhost:8000/upload-video", formData)
    setVideoName(res.data.video_name)
    setFrameCount(res.data.frame_count)
    setFps(res.data.frame_rate)
    setCurrentFrame(0)
    setBboxesByFrame({})

    // resume annotations
    const session = await loadSession(res.data.video_name)
    if (session) {
      const resume = window.confirm(`Resume previous session?\nLast saved: ${new Date(session.savedAt).toLocaleString()}`)
      if (resume) {
        setBboxesByFrame(session.bboxesByFrame)
        setClasses(session.classes)
        setClassColors(session.classColors ?? {})
      }
    }
  }

  // trigger re-extraction when quality changes
  async function changeQuality(newQuality) {
    if (!videoName || newQuality === quality) return
    setQuality(newQuality)
    setIsExtracting(true)
    await axios.post(`http://localhost:8000/reextract/${videoName}`, {
      quality: QUALITY_PRESETS[newQuality]
    })
    setIsExtracting(false)
  }
  // autosave annotations, only autosave if new bboxes drawn
  useEffect(() => {
    if (!videoName) return
    const interval = setInterval(() => {
      const current = JSON.stringify(bboxesByFrame)
      if (current === lastSavedRef.current) return  // nothing changed, skip
      saveSession(videoName, bboxesByFrame, classes, classColors)
        .then(() => {
          lastSavedRef.current = JSON.stringify(bboxesByFrame)
          setShowSaved(true)
          setTimeout(() => setShowSaved(false), 5000)
        })
    }, 15000) // every 15 secs

    return () => clearInterval(interval)
  }, [videoName, bboxesByFrame, classes, classColors])

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
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBboxIds.length > 0) { // delete bbox if selected + hit backspace/del
        e.preventDefault()
        deleteBboxes(selectedBboxIds)
        setSelectedBboxIds([])
      }
      if (e.key === 'w' || e.key === 'W') setMode(m => m === 'draw' ? 'select' : 'draw') // toggle between select and draw mode
      if (e.key === 'a' && e.ctrlKey) { // ctrl+a to select all boxes
        e.preventDefault()
        setSelectedBboxIds(frameBboxes.map(b => b.id))
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [videoName, frameCount, frameInterval, selectedBboxIds, frameBboxes])

  // prevent certain shortcuts (ctrl+s) from triggering browser
  useEffect(() => {
    const blockBrowserShortcuts = (e) => {
      if (!e.ctrlKey) return
      if (!['s', 'z', 'y', 'c', 'v'].includes(e.key)) return
      e.preventDefault()

      if (e.key === 's') {
        if (!videoName) return
        saveSession(videoName, bboxesByFrame, classes, classColors)
          .then(() => {
            lastSavedRef.current = JSON.stringify(bboxesByFrame)
            setShowSaved(true)
            setTimeout(() => setShowSaved(false), 5000)
          })
      }
      // ctrl+z, ctrl+y, ctrl+c, ctrl+v: blocked for now, logic added later
    }
    window.addEventListener('keydown', blockBrowserShortcuts)
    return () => window.removeEventListener('keydown', blockBrowserShortcuts)
  }, [videoName, bboxesByFrame, classes, classColors])

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

    function deleteBbox(id) { // used for delete button in context menu + right sidebar
    setBboxesByFrame(prev => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).filter(b => b.id !== id)
    }))
  }

  function updateBbox(id, newAttrs) { // used for single box drags
    setBboxesByFrame(prev => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).map(b =>
        b.id === id ? { ...b, ...newAttrs } : b
      )
    }))
  }

  function deleteBboxes(ids) { // delete group of bboxes
    const idSet = new Set(ids)
    setBboxesByFrame(prev => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).filter(b => !idSet.has(b.id))
    }))
  }

  function updateBboxes(updates) { // update group of bboxes
    setBboxesByFrame(prev => ({
      ...prev,
      [currentFrame]: (prev[currentFrame] ?? []).map(b => {
        const update = updates.find(u => u.id === b.id)
        return update ? { ...b, ...update } : b
      })
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
    const close = () => { setContextMenu(null); setSelectedBboxIds([]) }
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

    // export final annotation functions
  function exportCVATXML() {
    const { origW, origH, dispW, dispH } = imageDimsRef.current
    const scaleX = origW / dispW
    const scaleY = origH / dispH

    // CVAT timestamp format: "2026-05-22 02:31:39.107577+00:00"
    const formatDate = (date) =>
      date.toISOString()
        .replace('T', ' ')
        .replace(/(\.\d{3})Z$/, '$1000+00:00')

    const now = formatDate(new Date())

    const labelsXml = classes.map(cls => `
        <label>
          <name>${cls}</name>
          <color>${classColors[cls] ?? '#ffffff'}</color>
          <type>any</type>
          <attributes>
          </attributes>
        </label>`).join('')

    let trackId = 0
    const tracks = []

    for (const [frameIndex, boxes] of Object.entries(bboxesByFrame)) {
      for (const box of boxes) {
        const xtl = (box.x * scaleX).toFixed(2)
        const ytl = (box.y * scaleY).toFixed(2)
        const xbr = ((box.x + box.width) * scaleX).toFixed(2)
        const ybr = ((box.y + box.height) * scaleY).toFixed(2)
        const nextFrame = parseInt(frameIndex) + 1

        tracks.push(
          `  <track id="${trackId}" label="${box.className}" source="manual">\n` +
          `    <box frame="${frameIndex}" keyframe="1" outside="0" occluded="0" xtl="${xtl}" ytl="${ytl}" xbr="${xbr}" ybr="${ybr}" z_order="0">\n` +
          `    </box>\n` +
          `    <box frame="${nextFrame}" keyframe="1" outside="1" occluded="0" xtl="${xtl}" ytl="${ytl}" xbr="${xbr}" ybr="${ybr}" z_order="0">\n` +
          `    </box>\n` +
          `  </track>`
        )
        trackId++
      }
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
  <annotations>
    <version>1.1</version>
    <meta>
      <job>
        <id>1</id>
        <size>${frameCount}</size>
        <mode>interpolation</mode>
        <overlap>0</overlap>
        <bugtracker></bugtracker>
        <created>${now}</created>
        <updated>${now}</updated>
        <subset>default</subset>
        <start_frame>0</start_frame>
        <stop_frame>${frameCount - 1}</stop_frame>
        <frame_filter></frame_filter>
        <segments>
          <segment>
            <id>1</id>
            <start>0</start>
            <stop>${frameCount - 1}</stop>
            <url></url>
          </segment>
        </segments>
        <owner>
          <username></username>
          <email></email>
        </owner>
        <assignee></assignee>
        <labels>${labelsXml}
        </labels>
      </job>
      <dumped>${now}</dumped>
      <original_size>
        <width>${origW}</width>
        <height>${origH}</height>
      </original_size>
    </meta>
  ${tracks.join('\n')}
  </annotations>`

    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${videoName}_annotations.xml`
    a.click()
    URL.revokeObjectURL(url)
  }    
  
// UI block
return (
  <div style={{ display: "flex", height: "100vh", textAlign: "center" }}>

    {/* left sidebar */}

    {/* class section */}
    <div style={{ width: "20%", borderRight: "1px solid #ccc", padding: "8px" }}>
      <h3>Classes</h3>
      <p>Active class: {activeClass ?? "N/A"}</p> {/* shows selected class */}
      {/* new class input */}
      <input
        type="text"
        value={newClassName}
        onChange={(e) => setNewClassName(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation() ; if (e.key === "Enter") addClass() }}
        placeholder="Enter new class"
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <button onClick={addClass}>Add</button>  {/* button to add new class */}
      <ul>
        {/* class list & highlight (upon selection) */}
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

      {/* tag section */}
      <div style={{ borderTop: '1px solid #ccc', marginTop: 8, paddingTop: 8 }}>
        <h3>Tags</h3>
        {/* new tag input */}
        <input
          type="text"
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation() ; if (e.key === 'Enter') addTag() }}
          placeholder="Add new tag"
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        <button onClick={addTag}>Add</button>
        {/* tag list & application of tags on bbox */}
          {selectedBboxIds.length === 0 && <p style={{ color: '#888', fontSize: 12 }}>Select a bbox to apply tags.</p>}
          {selectedBboxIds.length > 1 && <p style={{ color: '#888', fontSize: 12 }}>{selectedBboxIds.length} boxes selected.</p>}

          <ul style={{ textAlign: 'left', padding: '0 4px', listStyle: 'none' }}>
            {tags.map(tag => {
              const selectedBboxes = frameBboxes.filter(b => selectedBboxIds.includes(b.id))
              const isChecked = selectedBboxes.length > 0 && selectedBboxes.every(b => (b.tags ?? []).includes(tag))
              return (
                <li key={tag} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={selectedBboxIds.length === 0}
                    onChange={() => selectedBboxIds.forEach(id => toggleBboxTag(id, tag))}
                  />
                  <span style={{ background: '#750000', color: '#FFFFFF', borderRadius: 3, padding: '1px 5px', fontSize: 11 }}>
                    {tag}
                  </span>
                  <button onClick={() => deleteTag(tag)} style={{ marginLeft: 'auto' }}>x</button>
                </li>
              )
            })}
          </ul>
      </div>
    </div>

    {/* center area */}

    <div style={{ flex: 1, padding: "8px", display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: 'center' }}>      
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* video input button */}
          <input
            type="file"
            accept="video/*"
            onChange={(e) => uploadVideo(e.target.files[0])}
          />
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 4 }}>
            {/* save button */}
            <button
              tabIndex={-1}
              disabled={!videoName}
              onClick={() => saveSession(videoName, bboxesByFrame, classes, classColors)
                .then(() => {
                  lastSavedRef.current = JSON.stringify(bboxesByFrame)
                  setShowSaved(true)
                  setTimeout(() => setShowSaved(false), 5000)
                })
              }
            >
              Save
            </button>
            {/* export as .xml button */}
            <button
              tabIndex={-1}
              disabled={!videoName}
              onClick={exportCVATXML}
            >
              Export XML
            </button>
          </div>
        </div>
        {/* saved indicator */}
        <span style={{
          fontSize: 12,
          color: '#009000',
          opacity: showSaved ? 1 : 0,
          transition: 'opacity 0.5s ease',
          pointerEvents: 'none',
        }}>
          ✓ Saved
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* mode toggle button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
            <h4 style={{ margin: 0 }}> Mode Toggle (W)</h4>
            <button
              tabIndex={-1} onClick={() => setMode('select')}
              style={{ 
                fontWeight: mode === 'select' ? 'bold' : 'normal',
                background: mode === 'select' ? '#750000' : '',
                color: mode === 'select' ? '#fff' : '',
                padding: '4px'
              }}
            >
              Select
            </button>
            <button
              tabIndex={-1} onClick={() => setMode('draw')}
              style={{
                fontWeight: mode === 'draw' ? 'bold' : 'normal',
                background: mode === 'draw' ? '#750000' : '',
                color: mode === 'draw' ? '#fff' : '',
                padding: '4px'
              }}
            >
              Draw
            </button>
          </div>
          <div>
            {/* frame quality toggle */}
            {videoName && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                <h4 style={{ margin: 0 }}>Quality</h4>
                {['low', 'medium', 'high'].map(q => (
                  <button
                    key={q}
                    tabIndex={-1}
                    disabled={isExtracting}
                    onClick={() => changeQuality(q)}
                    style={{
                      fontWeight: quality === q ? 'bold' : 'normal',
                      background: quality === q ? '#750000' : '',
                      color: quality === q ? '#fff' : '',
                      padding: '4px'
                    }}
                  >
                    {q.charAt(0).toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* re-extraction message */}
          {isExtracting && (
            <p style={{ color: '#750000', margin: '0', fontSize: '16px' }}>
              Re-extracting frames, please wait...
            </p>
          )}
        </div>
      </div>

      {/* konva stage: image display */}
      {videoName && (
        <div style={{width: '100%'}}>
          <p>Loaded: {videoName} ({frameCount} frames)</p> {/* shows total frame ct */}
          <AnnotationCanvas
            frameUrl={`http://localhost:8000/frame/${videoName}/${currentFrame}?q=${quality}`}
            activeClass={activeClass}
            classColors={classColors}
            frameBboxes={frameBboxes}
            addBbox={addBbox}
            selectedBboxIds={selectedBboxIds}
            setSelectedBboxIds={setSelectedBboxIds}
            openContextMenu={openContextMenu}
            mode={mode}
            updateBboxes={updateBboxes}
            onDimsReady={(dims) => { imageDimsRef.current = dims}}
          /> {/* calls fastAPI for image */}
          <div>
            {/* playback navigation */}
            <button tabIndex={-1} onClick={() => setCurrentFrame(f => Math.max(0, f - frameInterval))} disabled={currentFrame === 0 || isExtracting}>{"<<"}</button> {/* interval back */}
            <button tabIndex={-1} onClick={prevFrame} disabled={currentFrame === 0 || isExtracting}>{"<"}</button> {/* back button */}
            <span> Frame {currentFrame + 1} / {frameCount} </span>
            <button tabIndex={-1} onClick={nextFrame} disabled={currentFrame === frameCount - 1 || isExtracting}>{">"}</button> {/* forward button */}
            <button tabIndex={-1} onClick={() => setCurrentFrame(f => Math.min(frameCount - 1, f + frameInterval))} disabled={currentFrame === frameCount - 1 || isExtracting}>{">>"}  </button> {/* interval forward */}
          </div>
          <div>
            {/* frame interval setter */}
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
          {/* play/pause button */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button tabIndex={-1} onClick={() => setIsPlaying(p => !p)} disabled={isExtracting}>
              {isPlaying ? "Pause" : "Play"} 
            {/* video slider */}
            </button>
            <input
              type="range"
              min={0}
              max={frameCount - 1}
              value={currentFrame}
              onChange={(e) => setCurrentFrame(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#750000" }}
              disabled={isExtracting}
            />
            <span>{formatTime(currentFrame / fps)} / {formatTime(frameCount / fps)}</span>
          </div>
        </div>
      )}
    </div>

    {/* right sidebar */}

    <div style={{ width: "20%", borderLeft: "1px solid #ccc", padding: "8px" }}>
        <h3>Annotations</h3>
        {/* annotation list */}
        {frameBboxes.length === 0 ? (
          <p style={{ color: "#aaa" }}>No annotations yet.</p>
        ) : (
          <ul style={{ textAlign: "left", padding: "0 16px" }}>
            {frameBboxes.map((b, i) => (
              <li 
                key={b.id} 
                title={b.id}
                onContextMenu={(e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, b.id) }}
                style={{ background: selectedBboxIds.includes(b.id) ? '#333' : 'transparent' }}
              >
                {/* bbox tags */}
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
    
    {/* context menu style */}
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
    <div style={{ padding: '4px 10px', color: '#888', fontSize: 11, borderBottom: '1px solid #333' }}> {/* context menu text color */}
      Change class:
    </div>
    {/* class change toggle */}
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
        onMouseEnter={e => e.currentTarget.style.background = '#333'} // color of background of mouse hover
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ width: 10, height: 10, borderRadius: 2, background: classColors[cls] ?? '#fff', display: 'inline-block' }} />
        {cls}
      </div>
    ))}
    {/* tag toggle */}
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
      {/* delete annotation button */}
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