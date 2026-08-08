# Plan 05 — Toolbar and status rework

**Detail doc:** [`docs/changes/05-toolbar-status-rework.md`](../../docs/changes/05-toolbar-status-rework.md)

**Goal:** give the toolbar a primary action and a real status readout, make it
survive a narrow sidebar, and give it keyboard and screen-reader access.

**Depends on:** plan 04 (elevation, focus ring and motion tokens this builds on).

## Steps

1. Add an optional `onVideoSizeChange` callback to `useVideoDecoder`, fired from
   the existing size-change branch (`useVideoDecoder.ts:132-138`). A ref read
   cannot drive a render, so the status chip needs a push.
2. In `MirrorApp`, handle the `device-info` message instead of discarding it
   (`MirrorApp.tsx:109-111`) and hold video size in state.
3. Build `StatusChip` — dot + model + resolution + fps + battery, each field
   degrading independently, doubling as the device-dropdown trigger.
4. Restructure `Toolbar` into two rows: status chip, then nav group / primary
   pill / action group. Start/Stop becomes a filled labelled pill; everything
   else stays a `.btn-icon`.
5. Replace the inline device dropdown (`Toolbar.tsx:180-273`) with
   `components/DeviceSelector.tsx`, adding optional props for anything the
   mirror view needs that the shared component lacks.
6. Add `useDismissable(isOpen, onClose)` — Escape plus outside-pointerdown, with
   focus returned to the trigger. Use it for the device dropdown,
   `SettingsPanel` and `MorePanel`.
7. Accessibility: `aria-label` on every icon-only button (reuse the `Tooltip`
   `content` text), listbox roles on the dropdown, `role="dialog"` +
   `aria-modal` on the panels.
8. Responsive: media queries at 280px and 200px for the toolbar; convert
   `--phone-width` / `--phone-height` to a width plus `aspect-ratio` so
   `phoneFrame.css:22-23` scales instead of clipping.
9. Add `toolbarPosition` to `useSettingsStorage`, add a row for it in
   `SettingsPanel`, and delete the hardcoded `toolbarPosition="bottom"` at
   `MirrorApp.tsx:546`.
10. Move every inline style in `Toolbar.tsx` into CSS. The status-dot ring
    becomes `box-shadow: 0 0 0 2px var(--surface-raised)`.
11. Fix the screenshot tooltip copy (`Toolbar.tsx:341`) — it saves a PNG via a
    save dialog, it does not copy to the clipboard.

## Constraints

- `Toolbar` is `memo()`-wrapped and every new callback prop must be
  `useCallback`-stable, or the memo boundary breaks and the toolbar reconciles
  on every pan frame. See [03](../../docs/changes/03-pan-rerender-perf.md).
- The status chip updates on a 5s device-info poll and on resolution change —
  never per frame.
- No behaviour change to mirroring, input, or ADB.

## Checks

- Start/Stop is the dominant control at every width.
- Chip shows live model / resolution / fps / battery, and clears cleanly on
  disconnect.
- Sidebar dragged from wide to ~170px: no horizontal scroll, no clipped phone
  frame, no overlap.
- Toolbar Top setting moves the toolbar and flips the panel animations.
- Escape and outside-click close all three overlays; focus returns to trigger.
- Screen reader names every toolbar button.
- `rg -n "style=\{\{" webview-ui/src/components/Toolbar.tsx` → no hits.
- `MirrorApp` render count during a pan drag matches the plan 03 baseline.
- `npm run typecheck && npm run lint && npm run format:check` green.
