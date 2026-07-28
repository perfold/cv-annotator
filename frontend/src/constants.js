// global constants
const PALETTE = [
  // anotations will be auto assigned one of these colors
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#e91e63",
  "#00bcd4",
  "#ff5722",
  "#8bc34a",
  "#673ab7",
  "#ff9800",
  "#009688",
  "#cddc39",
];
const DEFAULT_TAGS = ["occluded", "blur", "cut-off", "image-error", "outlier"]; // default tags

const QUALITY_PRESETS = { low: 31, medium: 15, high: 1 }; // extracted frames' jpg quality

const FA_COLOR = "#750000";
const OUTLIER_COLOR = "#ff00ff";

// shared UI theme
const THEME = {
  surface: "#1a1a1a", // panels, popovers, context menu background
  surfaceRaised: "#2a2a2a", // selected/highlighted rows
  border: "#ccc", // all outer borders
  divider: "#333", // internal dividers between sections
  hover: "#333", // hover background
  text: "#fff", // text
  label: "#888", // labels/secondary text
  faint: "#666", // tertiary text
  accent: "#750000",
  danger: "#e74c3c", // delete color
  outlier: OUTLIER_COLOR, // outlier color
  outlierTick: "#ffcc00", // outlier tick marks on the slider
  radius: 4,
  shadow: "0 4px 12px rgba(0,0,0,0.5)",
};

export {
  PALETTE,
  DEFAULT_TAGS,
  QUALITY_PRESETS,
  FA_COLOR,
  OUTLIER_COLOR,
  THEME,
};
