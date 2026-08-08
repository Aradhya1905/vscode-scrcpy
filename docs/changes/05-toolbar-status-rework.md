# 05 — Toolbar and status rework

## Problem

The toolbar is one flat row of nine controls with no hierarchy, no responsive
behaviour, and no connection status beyond an 8px dot.

### Start/Stop has no more weight than Screenshot

`Toolbar.tsx:328-337` renders the primary action of the entire extension as a
`.btn-icon` — the same 32px transparent square used by Back, Home, Recents,
Screenshot, More and Settings. The only differentiator is an inline `color`:

```tsx
<button className="btn-icon" style={{ color: isConnected ? 'var(--vsc-red)' : 'var(--vsc-green)' }}>
```

Nothing about size, fill, or position says "this is the button you came here to
press". On a narrow sidebar it is the sixth of nine identical squares.

### Connection state is an 8px dot, and the real data is discarded

Status is communicated by `.device-status-dot` (`Toolbar.tsx:192-200`), 8px,
absolutely positioned over the phone glyph, with an inline
`border: '2px solid var(--vsc-secondary)'` that hardcodes the toolbar
background into a component that does not own it.

Meanwhile the data for a real status readout already arrives and is thrown away.
`MirrorApp.tsx:109-111`:

```tsx
case 'device-info':
    // Device info received but not used in new UI
    break;
```

`DeviceInfoService` polls every 5s and posts a full `DeviceInfo`
(`src/services/DeviceInfoService.ts:4-24`): model, Android version, SDK level,
battery level and charging state, network type, storage. All discarded.

Resolution is separately available: `useVideoDecoder` tracks it in
`videoSizeRef` (`useVideoDecoder.ts:96,132-138`) and already exposes
`getVideoSize()` (`:376`), which `MirrorApp` passes straight through to
`VideoCanvas`.

### Nine controls in one row, and exactly one media query in the sidebar

`rg -n "@media" webview-ui/src/styles` matches once outside the dark panels:
`zoomHud.css:88`. The toolbar row is a flex device selector (`flex: 1`), three
navigation buttons, and four action buttons, with no collapse rule. A VS Code
sidebar can be dragged well below 200px.

The phone frame has the same problem from the other direction:
`tokens.css:99-100` defines `--phone-width: 290px` / `--phone-height: 630px`,
consumed as fixed pixels at `phoneFrame.css:22-23`. Below ~314px of sidebar the
frame is clipped rather than scaled.

### The top/bottom toolbar feature is fully built and unreachable

`toolbarPosition` is plumbed through `Toolbar.tsx:33,69,130,176`,
`SettingsPanel.tsx:27`, `MorePanel.tsx:27`, and `.toolbar-at-top` has CSS in
`toolbar.css:10-12,20-23,57-60` and `settingsPanel.css:16-22`. The only call
site hardcodes it:

```tsx
// MirrorApp.tsx:546
toolbarPosition="bottom"
```

### Two device pickers

`components/DeviceSelector.tsx` is a memoized picker used by `FileManagerApp`,
`LogcatApp` and `ShellLogsApp`. `Toolbar.tsx:180-273` is a second, inline,
non-memoized implementation of the same control with its own dropdown markup,
used only by the mirror view.

### Icon-only buttons with no accessible name

`Toolbar.tsx` has zero `aria-label` attributes. Across the whole webview,
`aria-*` / `role` / `tabIndex` appear 15 times in 4 files, none of them the
toolbar. The `Tooltip` wrapper supplies a visual label on hover only; a screen
reader gets "button".

### Panels close only via their own X

`Toolbar.tsx:94-96` holds three independent booleans. Each panel is dismissed by
its own close button, or as a side effect of opening a sibling
(`Toolbar.tsx:183-187,365-369,383-388`). No Escape handler, no outside-click,
no focus containment. `AppLauncher.tsx:83` is the only component in the codebase
that binds a `keydown` listener.

## Change

### Toolbar structure

Two zones instead of one undifferentiated row:

```
┌────────────────────────────────────────────┐
│  ● Pixel 7 · 1080×2400 · 60fps · 82%      │   status chip (row 1)
├────────────────────────────────────────────┤
│  ◀  ●  ■        [ ▶ Start ]   📷  ⋮  ⚙   │   controls (row 2)
└────────────────────────────────────────────┘
```

- **Primary action.** Start/Stop becomes `.btn-primary-pill`: filled with
  `--accent` (Start) or `--danger` (Stop), `--radius-pill`, a text label, and
  `--shadow-1`. It is the only filled control in the toolbar.
- **Status chip.** A new `StatusChip` component consuming:
  - `status` for the dot colour and the connecting pulse,
  - `DeviceInfo.model` and `DeviceInfo.battery` from the `device-info` message
    that `MirrorApp.tsx:109` currently drops,
  - resolution from `getVideoSize()`, lifted into state on the size-change
    branch at `useVideoDecoder.ts:132-138` via a new optional
    `onVideoSizeChange` callback (a ref read cannot drive a render),
  - target fps from `settings.fps`.

  Fields degrade individually: no device info → model only; not connected →
  "Not connected" and nothing else.
- **Device selector moves into the status chip.** The chip is the dropdown
  trigger, which frees the whole control row for actions.
- **Deduplicate.** `Toolbar` uses `components/DeviceSelector.tsx` instead of its
  inline copy. Anything the mirror view needs that the shared component lacks is
  added as an optional prop.

### Responsive

Three breakpoints on the sidebar container:

| Width | Toolbar | Phone frame |
|---|---|---|
| ≥ 280px | status chip + full control row | 290px fixed |
| 200–280px | nav group collapses into the More menu | `min(290px, 100% - 24px)` with `aspect-ratio` |
| < 200px | status chip collapses to dot + model; primary pill becomes icon-only | as above |

`--phone-width` / `--phone-height` become a width plus an `aspect-ratio` so the
frame scales instead of clipping.

### Toolbar position

Expose `toolbarPosition` as a real setting in `useSettingsStorage` and wire it
from `MirrorApp.tsx:546`. The CSS and prop plumbing already exist; this is a
setting entry, a `SettingsPanel` row, and deleting the hardcoded literal.

### Accessibility

- `aria-label` on every icon-only button, matching the existing `Tooltip`
  `content` text.
- Device dropdown: `aria-expanded` / `aria-controls` on the trigger,
  `role="listbox"` on the list, `role="option"` + `aria-selected` on each row.
- Panels: `role="dialog"` + `aria-modal="true"` + `aria-label`.
- One shared `useDismissable(isOpen, onClose)` hook binding Escape and
  outside-pointerdown, used by the device dropdown, `SettingsPanel` and
  `MorePanel`. On close, focus returns to the trigger.

### Inline styles

Move `Toolbar.tsx:179,190,194-199,216,229-234` into `toolbar.css` /
`deviceSelector.css`. The status dot's `2px solid var(--vsc-secondary)` ring
becomes `box-shadow: 0 0 0 2px var(--surface-raised)` in the stylesheet, so it
tracks whatever surface the toolbar actually uses.

### Copy fix

`Toolbar.tsx:341` describes Screenshot as "Capture device screen to clipboard".
`ScrcpySidebarView.ts:769-796` opens a save dialog and writes a PNG to disk.
Change the description to "Save device screen as PNG".

## Files

- `webview-ui/src/components/Toolbar.tsx`
- `webview-ui/src/components/StatusChip.tsx` (new)
- `webview-ui/src/components/DeviceSelector.tsx`
- `webview-ui/src/components/SettingsPanel.tsx`, `MorePanel.tsx`
  (dialog semantics, dismiss hook, toolbar-position row)
- `webview-ui/src/hooks/useDismissable.ts` (new)
- `webview-ui/src/hooks/useVideoDecoder.ts` (optional `onVideoSizeChange`)
- `webview-ui/src/hooks/useSettingsStorage.ts` (`toolbarPosition`)
- `webview-ui/src/apps/MirrorApp.tsx` (handle `device-info`, video size state,
  pass `toolbarPosition`)
- `webview-ui/src/styles/toolbar.css`, `deviceSelector.css`, `buttons.css`,
  `phoneFrame.css`, `tokens.css`

## Verification

- Start/Stop is visually the dominant control at every sidebar width.
- Connect a device: the chip shows model, live resolution, target fps and
  battery. Pull the USB cable: it returns to "Not connected" without a stale
  resolution.
- Drag the sidebar from wide to ~170px: no horizontal scrollbar, no clipped
  phone frame, no overlapping controls, at any width.
- Switch the toolbar to Top in Settings: the toolbar moves, and the Settings and
  More panels open downward (`.toolbar-at-top .panel-overlay`, already styled).
- Escape closes the device dropdown, Settings, and More. A click on the video
  closes them. Focus returns to the button that opened them.
- Tab order runs status chip → nav → primary → actions, with a visible ring
  (from [04](04-token-cleanup-interaction.md)) on each.
- A screen reader announces every toolbar button by name.
- `rg -n "style=\{\{" webview-ui/src/components/Toolbar.tsx` returns nothing.
- `MirrorApp` render count during a pan drag is unchanged from
  [03](03-pan-rerender-perf.md) — `StatusChip` must not be re-created on every
  render, and `Toolbar` must stay behind its `memo` boundary, so every new
  callback prop is `useCallback`-stable.
- `npm run typecheck && npm run lint && npm run format:check` green.

## Rollback

Larger than 04 — it changes component structure. Revert the commit. The only
cross-boundary change is the optional `onVideoSizeChange` callback in
`useVideoDecoder`, which is additive and inert when not passed.
