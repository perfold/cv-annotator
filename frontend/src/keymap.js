// header labels. key is the global shortcut, action is what opens
const HEADER_GROUPS = [
  [
    { id: "import", label: "import", key: "i", action: "popover:import" },
    { id: "export", label: "export", key: "x", action: "popover:export" },
  ],
  [
    { id: "models", label: "models", key: "m", action: "popover:models" },
    { id: "outliers", label: "outlier", key: "o", action: "panel:outliers" },
  ],
  [
    { id: "classes", label: "classes", key: "c", action: "panel:classes" },
    { id: "tags", label: "tags", key: "t", action: "panel:tags" },
  ],
  [
    { id: "mode", label: "draw/select", key: "w", action: "mode:toggle" },
    {
      id: "annotations",
      label: "annotations",
      key: "a",
      action: "panel:annotations",
    },
  ],
];

// keybinds that only work when the popover is open, and takes priority over the global keybinds
const POPOVER_KEYS = {
  import: [
    { key: "u", label: "upload video", action: "import:upload" },
    { key: "x", label: "import xml", action: "import:xml" },
    { key: "p", label: "focus path", action: "import:path" },
    { key: "1", label: "low", action: "import:quality:low" },
    { key: "2", label: "medium", action: "import:quality:medium" },
    { key: "3", label: "high", action: "import:quality:high" },
  ],
  export: [
    { key: "x", label: "export xml", action: "export:xml" },
    { key: "s", label: "export stats", action: "export:stats" },
    { key: "c", label: "export chips", action: "export:chips" },
    { key: "v", label: "save", action: "export:save" },
  ],
  models: [
    { key: "y", label: "run yolo", action: "models:yolo" },
    { key: "e", label: "run embeddings", action: "models:embeddings" },
    { key: "t", label: "run tracking", action: "models:track" },
    { key: "b", label: "tighten boxes", action: "models:tighten" },
    { key: "p", label: "polygon", action: "models:polygon" },
  ],
};

// other global keybinds
const GLOBAL_KEYS = [
  { key: "h", label: "hide all", action: "view:hideAll" },
  { key: "l", label: "only flagged", action: "view:onlyFlagged" },
  { key: "p", label: "propagate", action: "bbox:propagate" },
  { key: "f", label: "mark fa", action: "bbox:markFa" },
  { key: "g", label: "mark outlier", action: "bbox:markOutlier" },
  { key: "s", label: "scan for outliers", action: "outliers:scan" },
  { key: "r", label: "remove all outliers", action: "outliers:removeAll" },
  { key: "d", label: "remove all fa", action: "fa:removeAll" },
];

function resolveKey(key, popoverName) {
  const lower = key.toLowerCase();
  if (popoverName && POPOVER_KEYS[popoverName]) {
    const hit = POPOVER_KEYS[popoverName].find((k) => k.key === lower);
    if (hit) return hit.action;
  }
  const header = HEADER_GROUPS.flat().find((k) => k.key === lower);
  if (header) return header.action;
  const global = GLOBAL_KEYS.find((k) => k.key === lower);
  return global ? global.action : null;
}

export { HEADER_GROUPS, POPOVER_KEYS, GLOBAL_KEYS, resolveKey };
