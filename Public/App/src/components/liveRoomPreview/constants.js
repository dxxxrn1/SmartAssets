export const A4_WIDTH_CM = 21;
export const A4_HEIGHT_CM = 29.7;
export const DEFAULT_PX_PER_CM = 3.78; // Approx. 96 CSS px per inch.
export const MIN_ITEM_SCALE = 0.5;
export const MAX_ITEM_SCALE = 2;
export const SENSOR_UPDATE_INTERVAL_MS = 80;

// ── 3D Camera & Sensor Constants ─────────────────────────────────────────────
export const VERTICAL_FOV_DEG = 60; // Standard 60° vertical FOV for metric scale projection
export const AXIS_SIGNS = { x: -1, y: 1, z: 1 }; // Isolated axis flips for sensor coordinates
export const LOW_PASS_ALPHA = 0.15; // Quaternion / angular smoothing coefficient
export const TARGET_MAX_FPS = 30; // 30 fps cap for stable mobile rendering
export const DEFAULT_DEPTH_CM = 25; // Default depth in cm if unspecified on 3D objects

