// ─── Reconciled Room Preview Screen ───────────────────────────────────────────
// Unifies ARViewer and LiveRoomPreview into a single intentional experience:
//   • Live camera background with a WebView 3D GLB model overlay (only when an
//     explicit 3D model URL is attached to the listing or in Demo Showcase mode)
//   • 2D listing photo overlay with clear no-3D-model indicator when a listing
//     has no 3D model attached
//   • Gyroscope tilt assist and A4 reference scale calibration (does not claim
//     native Android ARCore plane detection or world anchoring)

export { default } from '../components/liveRoomPreview/LiveRoomPreview';
