# Plan 03 — Pan re-render performance

**Detail doc:** [`docs/changes/03-pan-rerender-perf.md`](../../docs/changes/03-pan-rerender-perf.md)

**Goal:** stop reconciling the whole mirror UI on every pointer-move frame while
panning a zoomed view.

**Depends on:** nothing. Independent of plans 01 and 02.

## Steps

1. `webview-ui/src/apps/MirrorApp.tsx` — remove `panX, panY` from the dependency
   array of the `setCanvasCacheKey` effect. Keep `showDeviceSkin, zoom`. Update
   the comment above it to record why pan does not need the invalidation
   (middle-button pan sends no touches; `handlePointerDown` always re-reads the
   rect; `getCachedRect` expires after 100 ms anyway).
2. Same file — wrap every inline arrow passed to `<Toolbar>` in `useCallback`
   with correct dependencies. There are eleven: `onShowDeviceSkinChange`,
   `onGradientColor1Change`, `onGradientColor2Change`, `onDeviceSkinColorChange`,
   `onTouchFeedbackChange`, `onQualityChange`, `onFpsChange`, `onBitrateChange`,
   `onCursorStyleChange`, `onResetSettings`, `onPersistentMirroringChange`.

## Checks

- React DevTools → "Highlight updates when components render", then middle-drag
  a zoomed mirror. `Toolbar` and any open settings panel must not flash during
  the drag. `MirrorApp` still will — the pan offset is React state driving an
  inline transform, which the detail doc explains and leaves as a follow-up.
- Zoom to 200%, pan, then tap a known element on the device: the tap lands where
  it was aimed. This is the regression that removing the cache key could cause,
  so test it deliberately.
- Ctrl+wheel zoom still updates the HUD and still maps touches correctly.
- Toggling the device skin still remounts the canvas and maps touches correctly.
- `npm run typecheck && npm run lint && npm run format:check` green.
