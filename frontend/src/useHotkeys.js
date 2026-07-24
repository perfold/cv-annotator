import { useEffect } from "react";
import useStore from "./store";
import { resolveKey } from "./keymap";

// prevent typing into textboxes from triggering keybinds
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function useHotkeys({ popoverActions }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.ctrlKey || e.metaKey) return; // ctrl shortcuts are handled in app.jsx
      if (isTypingTarget(e.target)) return;

      const openPopover = useStore.getState().ui.openPopover;
      const action = resolveKey(e.key, openPopover);
      if (!action) return;

      if (action.includes(":") && popoverActions.current[action]) {
        e.preventDefault();
        popoverActions.current[action]();
        return;
      }

      const s = useStore.getState();

      if (action.startsWith("panel:")) {
        e.preventDefault();
        s.togglePanel(action.slice(6));
        return;
      }
      if (action.startsWith("popover:")) {
        e.preventDefault();
        s.setPopover(action.slice(8));
        return;
      }

      if (!s.videoName) return; // these need a video to be loaded in to work

      if (action === "mode:toggle") {
        e.preventDefault();
        useStore.setState({ mode: s.mode === "draw" ? "select" : "draw" });
        return;
      }
      if (action === "view:hideAll") {
        useStore.setState({ hideAllBboxes: !s.hideAllBboxes });
        return;
      }
      if (action === "view:onlyFlagged") {
        useStore.setState({ showOnlyFlagged: !s.showOnlyFlagged });
        return;
      }

      if (action === "outliers:scan") {
        e.preventDefault();
        if (!s.isScanning) s.scanOutliers();
        return;
      }
      if (action === "outliers:removeAll") {
        e.preventDefault();
        s.removeAllOutliers();
        return;
      }
      if (action === "fa:removeAll") {
        e.preventDefault();
        s.removeAllFa();
        return;
      }

      const selected = s.selectedBboxIds;
      if (selected.length !== 1) return;

      if (action === "bbox:propagate") {
        e.preventDefault();
        if (!s.isPropagating) s.propagateBox(selected[0]);
        return;
      }
      if (action === "bbox:markFa") {
        e.preventDefault();
        if (!s.isMarkingFa) s.markFaTrack(selected[0]);
        return;
      }
      if (action === "bbox:markOutlier") {
        e.preventDefault();
        s.confirmOutlier(selected[0]);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [popoverActions]);
}

export default useHotkeys;
