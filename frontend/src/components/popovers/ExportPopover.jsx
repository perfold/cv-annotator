import useStore from "../../store";
import Popover from "../Popover";
import usePopoverKeys from "../../usePopoverKeys";

function ExportPopover({ saveSession, lastSavedRef }) {
  const {
    videoName,
    bboxesByFrame,
    exportCVATXML,
    openStatsModal,
    openChipsModal,
    setPopover,
  } = useStore((s) => s);

  const doSave = () =>
    saveSession().then(() => {
      lastSavedRef.current = JSON.stringify(bboxesByFrame);
      useStore.setState({ showSaved: true });
      setTimeout(() => useStore.setState({ showSaved: false }), 5000);
    });

  // scoped keys, matching POPOVER_KEYS.export in keymap.js. note x shadows the
  // global x (which opens this popover) for as long as it's open, so escape or
  // the header label is how you close it
  usePopoverKeys({
    "export:xml": () => videoName && exportCVATXML(),
    "export:stats": () => {
      if (!videoName) return;
      openStatsModal();
      setPopover(null);
    },
    "export:chips": () => {
      if (!videoName) return;
      openChipsModal();
      setPopover(null);
    },
    "export:save": () => videoName && doSave(),
  });

  return (
    <Popover name="export" title="Export">
      {/* export as .xml button */}
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={exportCVATXML}
      >
        Export XML (X)
      </button>
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={() => {
          openStatsModal();
          setPopover(null); // the project modal is its own overlay, don't stack it under this
        }}
      >
        Export Stats (S)
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
        Export Chips (C)
      </button>

      {/* save button */}
      <button
        style={{ width: "100%", borderTop: "1px solid #333" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={doSave}
      >
        Save (V)
      </button>
    </Popover>
  );
}

export default ExportPopover;
