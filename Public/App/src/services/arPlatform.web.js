// ─── Web AR Platform Loader ──────────────────────────────────────────────────
// On web, native ARKit/ARCore is unavailable. Returns false so that ARStudioPreview
// provides an architectural 3D gallery room experience without throwing native errors.

export function loadViroModules() {
  return null;
}

export function isNativeARAvailable() {
  return false;
}

export function getViroModules() {
  return null;
}
