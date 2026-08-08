# 03 — Pan re-render performance

## Problem

Two defects compound into a full React reconcile of the entire mirror UI on
every mouse-move frame while the user middle-drags to pan a zoomed view.

### (a) Pan writes React state at pointer-move rate

`webview-ui/src/apps/MirrorApp.tsx`:

```tsx
useEffect(() => {
    setCanvasCacheKey((prev) => prev + 1);
}, [showDeviceSkin, zoom, panX, panY]);
```

`panX`/`panY` change on every `pointermove` during a pan drag (`useZoom.panBy`
is called directly from `VideoCanvas.handlePointerMove`). So this effect bumps
a state counter ~60–120 times a second, and each bump re-renders `MirrorApp`
and everything under it.

### (b) `memo()` on `Toolbar` is defeated

`Toolbar` is wrapped in `memo()`, but `MirrorApp` passes it inline arrow
functions:

```tsx
onGradientColor1Change={(color1) => { updateSetting('gradientColor1', color1); }}
onGradientColor2Change={(color2) => { ... }}
onDeviceSkinColorChange={(color) => { ... }}
onTouchFeedbackChange={(enabled) => ... }
onQualityChange={(value) => ... }
onFpsChange={...} onBitrateChange={...} onCursorStyleChange={...}
onResetSettings={() => { resetSettings(); resetZoom(); }}
onPersistentMirroringChange={(enabled) => ...}
onShowDeviceSkinChange={(value) => ...}
```

Eleven props get a fresh function identity on every render, so the `memo`
comparison always fails. `Toolbar` — and, when open, `SettingsPanel` (1085
lines) or `MorePanel` (790 lines) — re-renders every time.

Combined: panning a zoomed mirror reconciles the whole tree at pointer-event
rate, on the same thread that is decoding and drawing H.264 frames.

## Why removing `panX`/`panY` is safe

The cache key exists to invalidate `VideoCanvas`'s cached
`getBoundingClientRect()`, because a CSS `transform` moves the canvas without
firing its `ResizeObserver`, which would leave touch coordinates mapping to the
wrong place.

Pan does not actually need it, for three independent reasons:

1. Panning is bound to the **middle** mouse button
   (`VideoCanvas.handlePointerDown`, `event.button === 1`) and returns early —
   no touch events are generated while panning, so no stale rect can be read.
2. `handlePointerDown` for the primary button **unconditionally** re-reads
   `getBoundingClientRect()` before mapping coordinates. Any interaction after
   a pan starts from a fresh rect.
3. `getCachedRect()` self-expires after 100 ms regardless.

`zoom` is kept in the dependency list: it changes in discrete ladder steps
(a handful of renders), and keeping it makes the invalidation intent explicit.

## Change

1. Drop `panX, panY` from the cache-invalidation effect's dependency array;
   leave `showDeviceSkin, zoom`.
2. Wrap all `Toolbar` callback props in `useCallback` with correct dependencies,
   restoring the `memo()` boundary. This also fixes `SettingsPanel` and
   `MorePanel`, which sit behind the same boundary.

Both are local, behaviour-preserving edits. No new state, no new refs, no change
to the input or decode path.

## What this does and does not fix

`MirrorApp` itself **still re-renders once per pointer-move during a pan.**
`useZoom` holds the pan offset in `useState` and `MirrorApp` applies it as an
inline `style={{ transform: ... }}`, so the render is how the transform reaches
the DOM. That is inherent to the current design and is not addressed here.

What changes is the cost of that render:

- (a) removes the *second* render per move — the state bump was doubling them.
- (b) means the surviving render stops at the `memo(Toolbar)` boundary instead
  of reconciling `Toolbar` plus whichever of `SettingsPanel` (1085 lines) or
  `MorePanel` (790 lines) is open. This is the larger of the two wins.

Eliminating the last render would mean writing the transform imperatively to
`contentRef.current.style` from the pointer handler and keeping React state only
for the settled value. That is a bigger change to `useZoom`'s contract (`ZoomHud`
reads `panX`/`panY` for its `isPanned` prop) and is deliberately left as a
follow-up.

## Files

- `webview-ui/src/apps/MirrorApp.tsx`

## Verification

- React DevTools Profiler, "Highlight updates when components render", then
  middle-drag a zoomed mirror. Before: `MirrorApp`, `Toolbar`, and any open
  settings panel all flash on every move. After: only `MirrorApp` and the
  `.zoom-content` div flash; `Toolbar` and the panels stay quiet.
- Touch accuracy after a pan: zoom to 200%, pan, then tap a known UI element on
  the device — the tap must land where it was aimed. This is the regression that
  dropping the cache key could cause, so test it deliberately.
- Ctrl+wheel zoom still updates the HUD and still re-maps touches correctly.
- Device-skin toggle still remounts the canvas and re-maps touches correctly.
- Settings panel: changing quality/FPS/bitrate/colours still persists, and
  Reset still resets both settings and zoom (the `useCallback` wrapping must not
  have dropped a dependency).

## Rollback

Re-add `panX, panY` to the dependency array. The `useCallback` wrapping is
independently safe and can stay.
