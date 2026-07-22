import useStore from "../../store";
import Popover from "../Popover";

function ExportPopover({ saveSession, lastSavedRef }) {
  const {
    videoName,
    bboxesByFrame,
    exportCVATXML,
    openStatsModal,
    openChipsModal,
    setPopover,
  } = useStore((s) => s);

  return (
    <Popover name="export" title="Export">
      {/* export as .xml button */}
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={exportCVATXML}
      >
        Export XML
      </button>
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={() => {
          openStatsModal();
          setPopover(null);
        }}
      >
        Export Stats
      </button>
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={() => {
          openChipsModal();
          setPopover(null);
        }}
      >
        Export Chips
      </button>

      {/* save button */}
      <button
        style={{ width: "100%", borderTop: "1px solid #333" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={() =>
          saveSession().then(() => {
            lastSavedRef.current = JSON.stringify(bboxesByFrame);
            useStore.setState({ showSaved: true });
            setTimeout(() => useStore.setState({ showSaved: false }), 5000);
          })
        }
      >
        Save
      </button>
    </Popover>
  );
}

export default ExportPopover;
