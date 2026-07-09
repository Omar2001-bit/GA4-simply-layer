// Validated dark-mode palette (dataviz reference instance).
// App renders a committed dark theme; values chosen for the #0e1c26 surface.

export const SURFACE = "#0e1c26";
export const PAGE = "#020601";
export const INK = "#ffffff";
export const INK_SECONDARY = "#c2d1d5";
export const INK_MUTED = "#7f959d";
export const GRID = "#16262f";
export const BASELINE = "#24363f";
export const BORDER = "rgba(255,255,255,0.10)";

// Range A = current period (Optimizers brand green), Range B = comparison (darker green step, dashed)
export const SERIES_A = "#6ae499";
export const SERIES_B = "#2f9e66";

// Fixed-order categorical palette for dimension slices (pie/donut) —
// validated reference set (worst adjacent CVD ΔE in floor band; the always-present
// Numbers table + tooltips are the required secondary encoding).
// Brand green is reserved for the A/B series so slices never impersonate it.
export const CATEGORICAL = [
  "#3987e5", // blue
  "#199e70", // aqua
  "#c98500", // yellow
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
  "#d55181", // magenta
  "#d95926", // orange
];

export const DELTA_UP = "#0ca30c";
export const DELTA_DOWN = "#d03b3b";
