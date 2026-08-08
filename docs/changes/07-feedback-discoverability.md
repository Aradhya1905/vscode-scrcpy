# 07 — Feedback and discoverability

## Problem

The panel never speaks. Every acknowledgement leaves the sidebar and appears as
a VS Code notification in the opposite corner of the window, and every control
is discoverable only by hovering it.

### Acknowledgements land far from the user's eye

`ScrcpySidebarView.ts:771,791,794` — taking a screenshot warns, confirms, or
errors through `vscode.window.show*Message`. The same pattern is used for APK
install and the other panel actions. The user is looking at a phone screen in
the sidebar; the confirmation appears bottom-right, often after they have
already moved on. For a modal outcome ("saved to <path>") that is correct
behaviour; for a transient one ("screenshot saved", "APK installed", "text
pasted") it is the wrong surface.

### The panel already counts the numbers it never shows

`useVideoDecoder.ts` maintains `frameCountRef` (`:93`, incremented `:143`) and
`droppedFramesRef` (`:106`, incremented `:290`), and both are only ever passed
to `onLog` — which `MirrorApp.tsx:50-52` implements as an empty function:

```tsx
const addLog = useCallback((_message: string, _level = 'info') => {
    // Logging disabled for performance
}, []);
```

So the extension measures decode health on every frame and discards all of it.
When mirroring is choppy there is nothing in the UI to say whether the problem
is bitrate, the decoder falling behind, or the device.

### No keyboard access to anything

`package.json` contributes no `keybindings`. Start, stop and screenshot are
mouse-only. The `Tooltip` component (`components/Tooltip.tsx`, used at
`Toolbar.tsx:278,288,298,316,339,355,374`) already renders a title, a
description and an icon per control — it has a natural slot for a shortcut
chord and shows nothing there.

## Change

### In-panel toast layer

A `ToastHost` mounted once in `MirrorApp`, plus a `useToast` hook. Toasts stack
bottom-centre above the toolbar, auto-dismiss after 3s, pause on hover, and
animate with `transform`/`opacity` only.

Routing rule, so this does not become a second uncoordinated notification
channel:

| Outcome | Surface |
|---|---|
| Transient success (screenshot saved, APK installed, text pasted, device selected) | toast |
| Anything with a path, a link, or a follow-up action | VS Code notification (unchanged) |
| Connection failure | error state ([06](06-state-surfaces.md)), not a toast |

The extension gains a `toast` message type. Call sites that currently use
`showInformationMessage` for a transient success switch to it; warnings and
errors stay where they are.

### Perf HUD

An opt-in overlay, toggled from `MorePanel`, off by default, showing decoded
fps, dropped frames, decode queue depth and the negotiated resolution.

It must not cost what it measures:

- The decoder accumulates into refs (it already does) and flushes a snapshot
  through a callback **once per second**, not per frame.
- The HUD subscribes directly to that callback and writes to its own DOM node.
  It never lifts state into `MirrorApp` — that would re-render the tree once a
  second during streaming, undoing part of
  [03](03-pan-rerender-perf.md).
- When the toggle is off, no callback is installed and the counters stay
  ref-only, so the disabled path is exactly today's code.

### Keybindings and shortcut hints

- Contribute `vscode-scrcpy.startMirror`, `stopMirror` and a new
  `screenshot` command as `contributes.keybindings`, scoped with a
  `when` clause so they do not steal chords globally.
- Extend `TooltipProps` with an optional `shortcut?: string`, rendered as a
  `<kbd>` chip. The mirror view passes the chord for the controls that have one.
- Add the same chords as `aria-keyshortcuts` on those buttons.

### Non-goals

Device-facing features stay in [backlog.md](backlog.md): rotation lock, the
text-input field, audio, recording, wireless ADB, the layout inspector. This
change adds no new device capability — it surfaces information and actions that
already exist.

## Files

- `webview-ui/src/components/ToastHost.tsx`, `PerfHud.tsx` (new)
- `webview-ui/src/hooks/useToast.ts` (new)
- `webview-ui/src/hooks/useVideoDecoder.ts` (1 Hz stats callback, opt-in)
- `webview-ui/src/components/Tooltip.tsx` (`shortcut` prop)
- `webview-ui/src/components/MorePanel.tsx` (HUD toggle)
- `webview-ui/src/components/Toolbar.tsx` (chords on tooltips)
- `webview-ui/src/apps/MirrorApp.tsx` (mount `ToastHost`, wire HUD)
- `webview-ui/src/styles/toast.css`, `perfHud.css` (new)
- `webview-ui/src/types/index.ts` (`toast` message)
- `src/views/ScrcpySidebarView.ts` (post `toast` for transient successes)
- `package.json` (`contributes.keybindings`, screenshot command)

## Verification

- Take a screenshot: a toast appears in the sidebar. The save-path confirmation
  still appears as a VS Code notification, since it names a path.
- Fire several actions quickly: toasts stack, do not overlap the toolbar, and
  each dismisses on its own timer. Hovering one holds it.
- HUD off (default): `MirrorApp` render count while streaming is unchanged from
  the [03](03-pan-rerender-perf.md) baseline, and no stats callback is
  installed.
- HUD on: numbers update once per second. Profile 30s of streaming — no
  additional React render is attributable to the HUD.
- Lower the bitrate to 1 Mbps and confirm the dropped-frame counter moves, so
  the readout is real rather than decorative.
- Keybindings start and stop the mirror with the sidebar focused and do nothing
  when it is not. Tooltips show the chord.
- `npm run typecheck && npm run lint && npm run format:check` green.

## Rollback

Each of the three pieces is independent — toasts, HUD, keybindings — and can be
reverted separately. The decoder change is a guarded opt-in callback; with no
subscriber the hook behaves exactly as before.
