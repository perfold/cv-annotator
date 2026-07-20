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

export { PALETTE, DEFAULT_TAGS, QUALITY_PRESETS, FA_COLOR, OUTLIER_COLOR };
