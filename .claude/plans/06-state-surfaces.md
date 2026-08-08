# Plan 06 — State surfaces

**Detail doc:** [`docs/changes/06-state-surfaces.md`](../../docs/changes/06-state-surfaces.md)

**Goal:** make idle, connecting, error and empty-device states honest and
actionable instead of decorative.

**Depends on:** plan 04 (tokens/motion) and plan 05 (`device-info` handling and
video-size state, which the idle state reuses).

## Steps

1. Split `Placeholder.tsx` into a router over `IdleState`, `ConnectingState` and
   `ErrorState`. Keep the phone silhouette for idle and connecting; drop it for
   errors.
2. Idle: delete the hardcoded `1080 × 2400 @ 60fps` (`Placeholder.tsx:143`).
   Show the real resolution once one has been decoded this session, plus model
   and Android version from `DeviceInfo`. Omit the line when there is no data.
3. Connecting: replace the arc spinner with a `transform`-only shimmer skeleton.
   Tokenize the hardcoded `rgba(48,54,61,.5)` (`:78`) and the `#bc8cff` /
   `#58a6ff` gradient stops (`:101-102`).
4. Emit a `connect-progress` message from `ScrcpySidebarView` at the points
   where the server is pushed, started, and the first frame is awaited. Label
   each stage in the webview; fall back to "Connecting…" if none arrives.
5. Add a 15s per-stage stall timer that surfaces a "taking longer than usual"
   line with Cancel.
6. Error: build the card. Derive the title from the failure kind (unauthorised /
   no device / adb missing / server push failed / stream ended), show the raw
   message in `--font-mono` and selectable, and add actions — Retry, Check
   devices (`adb devices`), Restart adb server, Troubleshooting. Route the two
   new shell actions through the existing `AdbShellService`.
7. Replace the inline-styled "No devices found" (`Toolbar.tsx:228-237`) with an
   `EmptyDevices` component: glyph, hint about USB debugging, full-width Rescan.
8. Derive the default backdrop gradient from `--accent`/`--surface` in
   `MirrorApp.tsx:428-444`. Move the pink/blue literals to the `SettingsPanel`
   colour-picker defaults so saved user colours are unaffected.

## Constraints

- Neither new shell action is destructive; both are things a user can already
  run in a terminal. No device-state mutation from an error screen.
- The shimmer must animate `transform`/`opacity` only — this surface is on
  screen exactly when the decoder is starting up.
- A user with saved `gradientColor1`/`gradientColor2` must see no change.

## Checks

- `rg -n "1080|2400" webview-ui/src/components` → no hits.
- Idle before any stream: no spec line. After one: the real resolution.
- Connect and watch the stage label advance. Kill adb mid-connect: stall line
  and Cancel appear.
- Unplug and start: the error title names the real cause; all four actions work;
  "Check devices" shows real `adb devices` output.
- Empty dropdown shows the hint and Rescan; Rescan repopulates.
- Default backdrop matches the theme on Dark+ and Light+; saved colours
  unchanged.
- `rg -n "238, 174, 202|148, 187, 233" webview-ui/src` → `SettingsPanel` only.
- Connecting skeleton shows no paint per animation frame.
- `npm run typecheck && npm run lint && npm run format:check` green.
