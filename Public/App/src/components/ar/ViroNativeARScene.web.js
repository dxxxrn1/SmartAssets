// ─── Web AR Scene Fallback ──────────────────────────────────────────────────
// Returns a no-op component on Web since Web uses ARStudioPreview.

export default function createViroARScene() {
  return function DummyWebARScene() {
    return null;
  };
}
