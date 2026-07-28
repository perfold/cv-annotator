import useStore from "../../store";
import { THEME } from "../../constants";
import Popover from "../Popover";
import usePopoverKeys from "../../usePopoverKeys";

function ExportPopover({ saveSession, lastSavedRef }) {
  const {
    videoName,
    bboxesByFrame,
    exportCVATXML,
    openStatsModal,
    openChipsModal,
  } = useStore((s) => s);

  const doSave = () =>
    saveSession().then(() => {
      lastSavedRef.current = JSON.stringify(bboxesByFrame);
      useStore.setState({ showSaved: true });
      setTimeout(() => useStore.setState({ showSaved: false }), 5000);
    });

  usePopoverKeys({
    "export:xml": () => videoName && exportCVATXML(),
    "export:stats": () => videoName && openStatsModal(),
    "export:chips": () => videoName && openChipsModal(),
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
        onClick={openStatsModal}
      >
        Export Stats (S)
      </button>
      <button
        style={{ width: "100%" }}
        tabIndex={-1}
        disabled={!videoName}
        onClick={openChipsModal}
      >
        Export Chips (C)
      </button>

      {/* save button */}
      <button
        style={{ width: "100%", borderTop: `1px solid ${THEME.divider}` }}
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
