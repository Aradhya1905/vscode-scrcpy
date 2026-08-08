# 06 — State surfaces

## Problem

Everything the user sees before a stream exists is rendered inside a decorative
fake phone: `Placeholder.tsx` returns the same `.phone-frame` /
`.phone-screen` / notch / side-button scaffolding for all three of its states
(`:12-55`, `:62-118`, `:123-152`). The frame is ~290×630px of chrome around a
one-line message, and it constrains every state to that column.

### The idle state reports a resolution it invented

`Placeholder.tsx:141-144`:

```tsx
<div className="placeholder-info">
    <Info size={8} />
    <span>1080 × 2400 @ 60fps</span>
</div>
```

Hardcoded, shown for every device, at 9px in `rgba(139,148,158,0.6)`
(`placeholder.css:61-67`). A user with a 1440p tablet is told they have a 1080p
phone. This is the only "spec" text in the UI and it is fiction.

### The error state is a paragraph, not a recovery path

`Placeholder.tsx:20-48`: a triangle glyph, the title "Connection Lost"
regardless of what actually failed, the raw error string at 9px
(`placeholder.css:163-168`), and a single Retry button. Retry
(`MirrorApp.tsx:191-209`) sends `stop`, waits 300ms, sends `start`. For the
common causes — no device authorised, adb server not running, device asleep,
another scrcpy holding the device — retrying unchanged fails again with the same
message, and the panel offers nothing else.

"Connection Lost" is also wrong for the most common case: failing to connect in
the first place means nothing was ever lost.

### The connecting state is an undifferentiated spinner

`Placeholder.tsx:60-119` shows a rotating arc and the word "Connecting...".
Starting a stream involves pushing the scrcpy server to the device, starting it,
negotiating the video socket, and waiting for the first keyframe. On a cold
device that is several seconds of identical spinner, so a hang is
indistinguishable from normal progress.

The spinner also hardcodes colours that the token layer was supposed to own:
`rgba(48, 54, 61, 0.5)` (`:78`) and the gradient stops `#bc8cff` → `#58a6ff`
(`:101-102`).

### The empty device list is inline-styled body text

`Toolbar.tsx:228-237`:

```tsx
<div style={{ padding: '20px', textAlign: 'center', color: 'var(--vsc-text-muted)', fontSize: '12px' }}>
    No devices found
</div>
```

This is the first thing a new user sees, and it is a dead end — no hint about
USB debugging, no rescan affordance beyond the small icon in the header
(`Toolbar.tsx:214-224`).

### The default backdrop

`MirrorApp.tsx:433-434` defaults to
`radial-gradient(circle, rgba(238,174,202,1) 0%, rgba(148,187,233,1) 100%)` —
pink to periwinkle, fixed, ignoring the theme, applied whenever the device skin
is on or the stream is down. It is the largest coloured area in the panel and
the least connected to anything else on screen.

## Change

### Split the placeholder into three real components

`Placeholder.tsx` becomes a router over `IdleState`, `ConnectingState` and
`ErrorState`. The fake phone frame is kept **only** for idle and connecting,
where the silhouette reads as "your device goes here". The error state drops it
and becomes a full-width card, because a phone frame around an error message
makes the error look like device output.

### Idle

- Real specs or none. Resolution comes from `getVideoSize()` once a stream has
  run in this session; model and Android version from the `DeviceInfo` that
  [05](05-toolbar-status-rework.md) starts consuming. With no data, the line is
  omitted rather than invented.
- The line moves from 9px muted grey to `--text-sm` / `--text-muted`.
- Keeps the gradient play button (`placeholder.css:29-52`) as the single
  accent, retargeted at `--accent`.

### Connecting

- Replace the arc spinner with a shimmer skeleton inside the phone silhouette —
  a masked gradient sweep, `transform`-animated only, so it costs one composited
  layer and no paint per frame.
- Show the stage instead of a generic word. The extension already knows: add a
  `connect-progress` message from `ScrcpySidebarView` with a
  `'pushing-server' | 'starting' | 'awaiting-video'` discriminant, emitted at
  the points where those steps already happen. The webview labels each one and
  falls back to "Connecting…" if no stage has arrived.
- After 15s in any one stage, surface a "Taking longer than usual" line with a
  Cancel action, so a hang is visibly a hang.
- All hardcoded colours in this state move to `--border` / `--accent` /
  `--purple`.

### Error

A card, full sidebar width, with:

- A title derived from the failure rather than always "Connection Lost":
  unauthorised device, no device, adb not found, server push failed, stream
  ended. Anything unrecognised keeps a generic title and shows the raw message.
- The raw message in `--font-mono` at `--text-sm`, selectable, wrapped — not
  9px centred prose.
- Real actions, not just Retry:
  - **Retry** — existing `handleRetry` (`MirrorApp.tsx:191`).
  - **Check devices** — runs `adb devices` and shows the output, so the user can
    see an `unauthorized` line rather than guessing.
  - **Restart adb server** — `adb kill-server && adb start-server`, the fix for
    a large share of real failures.
  - **Troubleshooting** — opens the README section.

  Both new actions go through the existing `AdbShellService`; neither is
  destructive, and both are already possible from a terminal today.

### Empty device list

Replace the inline-styled div with an `EmptyDevices` component: muted USB glyph,
"No devices found", a one-line hint ("Enable USB debugging on the device, then
rescan"), and a full-width **Rescan** button calling the existing
`onRefreshDevices`.

### Default backdrop

Derive the default from the theme:

```css
--video-container-bg-gradient:
  radial-gradient(circle at 50% 40%,
    color-mix(in srgb, var(--accent) 12%, var(--surface)) 0%,
    var(--surface) 100%);
```

The user's saved `gradientColor1` / `gradientColor2` still win — only the
default changes, so nobody who has picked colours sees a difference. The pink
and blue literals move out of `MirrorApp.tsx:433-434` and become the initial
values of the two colour pickers in `SettingsPanel`, where they are a choice
rather than a default.

## Files

- `webview-ui/src/components/Placeholder.tsx` (router)
- `webview-ui/src/components/states/IdleState.tsx`, `ConnectingState.tsx`,
  `ErrorState.tsx`, `EmptyDevices.tsx` (new)
- `webview-ui/src/components/Toolbar.tsx` (use `EmptyDevices`)
- `webview-ui/src/apps/MirrorApp.tsx` (connect stage state, theme-derived
  gradient default, new error actions)
- `webview-ui/src/types/index.ts` (`connect-progress` message, error kind)
- `webview-ui/src/styles/placeholder.css`, `videoContainer.css`
- `src/views/ScrcpySidebarView.ts` (emit `connect-progress`; handle
  `check-devices` and `restart-adb-server`)

## Verification

- Idle with no prior stream: no resolution line at all. After one stream, the
  line shows the resolution actually decoded.
- `rg -n "1080|2400" webview-ui/src/components` returns nothing.
- Start a stream and watch the label move through pushing → starting → awaiting
  video. Kill the adb server mid-connect: the stage stalls and the
  "taking longer" line appears with Cancel.
- Unplug a device and start: the error title names the actual cause, the raw
  message is selectable, and all four actions work. "Check devices" shows real
  `adb devices` output.
- With no device attached, the dropdown shows the empty state and Rescan
  repopulates the list once a device is plugged in.
- Fresh install on Dark+ and on Light+: the default backdrop matches the theme
  in both. A user with saved gradient colours sees them unchanged.
- `rg -n "238, 174, 202|148, 187, 233" webview-ui/src` matches only
  `SettingsPanel` colour-picker defaults.
- Connecting skeleton: DevTools → Performance shows no paint per animation
  frame.
- `npm run typecheck && npm run lint && npm run format:check` green.

## Outcome

Shipped on `feature/token-cleanup-interaction`. `npm run typecheck`, the webview
`tsc -b && vite build`, `npm run lint` and `npm run format:check` are all green.

### What shipped as written

- `Placeholder.tsx` is a router over `IdleState`, `ConnectingState` and
  `ErrorState`. The silhouette moved into a shared `DeviceSilhouette` used by
  idle and connecting only; the error surface is a full-width card.
- The hardcoded resolution is gone. `rg -n "1080|2400" webview-ui/src/components`
  returns nothing. The idle spec line is assembled from the model, the Android
  version and the resolution actually decoded, and is omitted entirely when
  there is nothing to report.
- The arc spinner is a `transform`-only shimmer. The `rgba(48,54,61,.5)` stroke
  and the `#bc8cff` → `#58a6ff` gradient stops are gone; the sweep is
  `color-mix(in srgb, var(--accent) 16%, transparent)`.
- `connect-progress` carries `'pushing-server' | 'starting' | 'awaiting-video'`
  from `ScrcpyService` through `ScrcpySidebarView` to the webview, which labels
  each stage and falls back to "Connecting…" when none has arrived.
- A 15s per-stage stall timer surfaces "Taking longer than usual." with Cancel.
  It restarts on every stage change, so it measures time in one stage rather
  than total connect time — a slow but advancing connect never trips it.
- The error card derives its title from the failure (`errorKinds.ts`), shows the
  raw message in `--font-mono`, selectable and wrapped, and offers Retry, Check
  devices, Restart adb server and Troubleshooting.
- `EmptyDevices` replaces the inline-styled empty list.
- The backdrop default is `--backdrop-default` in `tokens.css`, derived from
  `--accent` and `--surface`.

### Deviations

- **Where the empty list lives.** The plan points at `Toolbar.tsx:228-237`, but
  [05](05-toolbar-status-rework.md) had already moved that markup into
  `DeviceSelector`'s dropdown. `EmptyDevices` is consumed there instead.
- **Diagnostics needed a host-level ADB call.** `AdbShellService` could only run
  commands scoped to a device (`-s <id>`), which is exactly what is unavailable
  when the device list is the problem. Added `executeHostCommand(args)`, used by
  `adb devices -l` and `adb kill-server` / `adb start-server`. Both are
  read-only with respect to the device; neither touches device state.
- **The gradient default had to be removed from `DEFAULT_SETTINGS`, not just
  from `MirrorApp`.** `useSettingsStorage` seeded every install with the pink
  and periwinkle pair, so a theme-derived default would never have applied.
  They are now `undefined`, and `MirrorApp` only builds a gradient string when
  both colours are set. Anyone who has run the panel before has the pair
  persisted in `vscode.getState()` and sees no change; a fresh install, and a
  settings reset, get the theme-derived backdrop.
- **`constants.ts` cleanup.** `VIDEO_CONTAINER_BACKGROUND_GRADIENT` was exported
  but imported nowhere, and its comments held the pink/blue literals while
  claiming to control the backdrop. Replaced with a pointer to
  `--backdrop-default`, which is what actually controls it.
- **A README `## Troubleshooting` section did not exist.** Added one, keyed to
  the same failure causes the error card classifies; the Troubleshooting action
  opens it via `vscode.env.openExternal`.
- **Two extra pieces of `MirrorApp` state.** `lastDeviceInfo` and
  `lastVideoSize` deliberately survive a disconnect. The status chip clears its
  live fields on purpose ([05](05-toolbar-status-rework.md)), but the idle
  surface is supposed to report what was observed this session, so it cannot
  read the same state.

### Still needs a human in an Extension Development Host

- Watching the stage label advance through pushing → starting → awaiting video
  on a real device, and confirming the stall line appears when the adb server is
  killed mid-connect.
- The four error actions against a genuinely unauthorised / unplugged device,
  including whether each failure classifies to the right title.
- The default backdrop on Dark+ and Light+ side by side.
- DevTools → Performance on the connecting skeleton, confirming no paint per
  animation frame.

## Rollback

The webview side reverts as one commit. The `connect-progress` message and the
two new shell commands in `ScrcpySidebarView` are additive — an older webview
ignores unknown message types, so the extension side can stay if only the UI is
rolled back.
