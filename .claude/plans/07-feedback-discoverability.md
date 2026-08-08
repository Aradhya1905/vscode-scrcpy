# Plan 07 — Feedback and discoverability

**Detail doc:** [`docs/changes/07-feedback-discoverability.md`](../../docs/changes/07-feedback-discoverability.md)

**Goal:** let the panel acknowledge its own actions, expose the decode stats it
already collects, and make the controls reachable from the keyboard.

**Depends on:** plan 04 (motion tokens) and plan 05 (tooltip and toolbar
structure). The three pieces below are independent of each other and can land
separately.

## Steps

### Toasts

1. Add `ToastHost` + `useToast`. Bottom-centre stack above the toolbar,
   3s auto-dismiss, pause on hover, `transform`/`opacity` animation only.
2. Add a `toast` message type and post it from `ScrcpySidebarView` for transient
   successes. Keep `vscode.window.show*Message` for anything naming a path or
   offering a follow-up action, and keep connection failures in the error state
   from plan 06.

### Perf HUD

3. Add an opt-in 1 Hz stats callback to `useVideoDecoder`, flushing the existing
   `frameCountRef` (`:93`) and `droppedFramesRef` (`:106`) plus decode queue
   depth and resolution. No callback installed when the HUD is off.
4. Build `PerfHud`, subscribing to that callback and writing to its own DOM
   node. It must not lift state into `MirrorApp`.
5. Add the toggle to `MorePanel`, default off.

### Keyboard

6. Contribute `contributes.keybindings` for start, stop and a new screenshot
   command, with a `when` clause scoping them to the sidebar.
7. Add an optional `shortcut?: string` to `TooltipProps`, rendered as a `<kbd>`
   chip, and pass the chords from `Toolbar`. Mirror them as
   `aria-keyshortcuts` on the buttons.

## Constraints

- With the HUD off the code path must be identical to today's — the counters
  stay ref-only and nothing subscribes.
- The HUD must never cause a `MirrorApp` render. A 1 Hz re-render of the tree
  during streaming would undo part of plan 03.
- No new device capability here. Rotation, text input, audio, recording,
  wireless ADB and the layout inspector stay in the backlog.

## Checks

- Screenshot fires a toast; the save-path confirmation stays a VS Code
  notification.
- Rapid actions stack toasts without overlapping the toolbar; hover holds one.
- HUD off: `MirrorApp` render count during streaming matches the plan 03
  baseline.
- HUD on: numbers update once per second, and no React render is attributable to
  it over 30s of profiling.
- At 1 Mbps the dropped-frame counter moves.
- Keybindings work with the sidebar focused and are inert otherwise; tooltips
  show the chords.
- `npm run typecheck && npm run lint && npm run format:check` green.
