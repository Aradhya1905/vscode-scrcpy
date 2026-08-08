# Backlog — audit findings not yet scheduled

From the August 2026 codebase audit. Nothing here is in progress. Ordered
roughly by value-to-effort. Line references are against `main` at commit
`25e060f`.

## Performance / correctness

### Video frames go through base64 and a per-byte JS loop

`src/views/ScrcpySidebarView.ts:428` encodes each batch with
`combined.toString('base64')`; `webview-ui/src/hooks/useVideoDecoder.ts:192-207`
decodes it with `atob()` followed by a scalar `charCodeAt` loop over every byte.

At the default 8 Mbps that is roughly 1 MB/s pushed through an interpreted
per-byte loop, plus ~33% payload inflation across the postMessage boundary.
`postMessage` structured-clones a `Uint8Array` directly, so both the encode and
the decode can be deleted. Worth measuring before and after — the win should
show up as reduced main-thread time in the webview.

### Decoder synthesises timestamps instead of using PTS

`useVideoDecoder.ts:333-342` derives `EncodedVideoChunk.timestamp` from
`performance.now()` at arrival time. `ScrcpyMediaStreamPacket` carries the real
`pts` from the device. Because frames are batched on an 8 ms timer
(`ScrcpySidebarView.ts:432`), arrival time is a jittered version of capture
time, which works against `optimizeForLatency`.

### Zoom is a CSS upscale of the canvas bitmap

`.zoom-content` scales the canvas with a CSS transform, so past roughly 150–200%
the GPU is upscaling a fixed-resolution bitmap and the image goes soft. Options:
size the canvas backing store by `devicePixelRatio * zoom`, or re-request the
stream at a higher `maxSize` when zoomed in.

### Frames are drawn straight from the decoder callback

`useVideoDecoder.renderFrame` calls `drawImage` from the `VideoDecoder` output
callback. With the 8 ms batching upstream, several frames can arrive together
and be drawn within one display refresh — work that is thrown away. A
"latest frame wins" buffer presented from a `requestAnimationFrame` loop would
cap drawing at display rate.

## Extension hygiene

### No `contributes.configuration`

Every setting lives in the webview's `vscode.setState`
(`webview-ui/src/hooks/useSettingsStorage.ts`). That means: not visible in the
Settings UI, not settable per-workspace, not covered by Settings Sync, and not
readable by the extension host. Quality, FPS, bitrate, and persistent mirroring
in particular should be real contributed settings.

### `audioForward` setting is dead

`AppSettings.audioForward` defaults to `true` in `useSettingsStorage.ts` and is
never read. `src/services/ScrcpyService.ts:138` hardcodes `audio: false`.
Either wire it up (see the audio feature below) or remove the setting so it
stops implying a capability that does not exist.

### `console.log` in production paths

Against the project's own rule in `CLAUDE.md`. Call sites:
`src/views/ScrcpySidebarView.ts:651,659,665,670,672`,
`webview-ui/src/components/VideoCanvas.tsx:89,98,101,531,542`.
Route to a VS Code output channel instead.

### Redundant activation events

`package.json` lists `onCommand:*` entries. VS Code has generated these
automatically from `contributes.commands` since 1.74; the extension declares
`^1.85.0`. They can be deleted.

### Inline `require` for a panel

`src/views/ScrcpySidebarView.ts:243` uses
`require('../panels/LogcatPanel')` while every other panel is a top-level ESM
import. Inconsistent and opaque to bundler analysis.

### Pan still re-renders `MirrorApp` once per pointer-move

Change 03 removed the duplicate render and restored the `memo(Toolbar)`
boundary, but the pan offset still lives in `useZoom`'s React state and reaches
the DOM through an inline `style={{ transform }}` on `.zoom-content`. Writing
the transform imperatively to `contentRef.current.style` during the drag, and
committing to state only when the gesture settles, would take it to zero
renders. Needs a change to `useZoom`'s contract, since `ZoomHud` reads
`panX`/`panY` for its `isPanned` prop.

### Migrate the heavy panels off hardcoded colours

`logcat.css`, `logs.css`, `fileManager.css` and `shellLogs.css` hardcode dozens
of dark colour values, so `.logcat-root`, `.fm-root` and `.sl-root` are pinned
to a dark palette by a scoped block in `tokens.css`. Migrating each panel onto
the semantic tokens and deleting its selector from that block is what makes the
whole extension theme-aware. `logcat.css` is the largest (46 hex + 88 rgba) and
much of it is log-level syntax colouring that wants a proper light-theme
counterpart rather than a straight substitution.

## UI rework — now scheduled

The UI items that used to live here are scheduled as changes 04–07. See
[README.md](README.md) for the table.

| Was | Now |
|---|---|
| Toolbar hierarchy (primary pill + status chip) | [05](05-toolbar-status-rework.md) |
| Elevation language extended past the zoom HUD | [04](04-token-cleanup-interaction.md) |
| Connecting / error states | [06](06-state-surfaces.md) |
| Default backdrop derived from the theme | [06](06-state-surfaces.md) |
| Placeholder's fabricated `1080 × 2400 @ 60fps` | [06](06-state-surfaces.md) |
| Perf HUD, keybindings | [07](07-feedback-discoverability.md) |

The "hit targets" item is dropped rather than scheduled: it claimed 12–14px
glyphs inside 26–28px buttons, but `buttons.css:32-68` is already a 32px box
with a 16px glyph. The real defect there is that `.btn-icon svg` overrides
lucide's `size` prop, which is [04](04-token-cleanup-interaction.md).

## Features

Ranked by value to effort.

1. **Audio forwarding.** `audio: false` is hardcoded. scrcpy 2.x/3.x carries
   AAC/Opus on the same connection; decode with WebCodecs `AudioDecoder` into an
   `AudioContext`. The single biggest missing capability.
2. **Screen recording.** The H.264 elementary stream is already in hand — mux to
   fragmented MP4 in the webview and save. "Record a repro clip" is a daily
   developer need.
3. **Wireless ADB.** `adb pair` / `adb connect` flow. Today the extension is
   effectively USB-only.
4. **Layout inspector.** `uiautomator dump` parsed into bounding boxes overlaid
   on the canvas, click to copy `resource-id`. Reuses the existing
   canvas→device coordinate mapping in `VideoCanvas` almost verbatim.
5. **Deep-link launcher.** A box that runs
   `am start -a android.intent.action.VIEW -d <url>`.
6. **Multiple devices side by side.**
7. Rotate / lock orientation (`wm user-rotation`).
8. A text-input field that types into the device without canvas focus games.
9. Drag-and-drop an APK onto the mirror to install it.

The perf HUD and `contributes.keybindings` moved out of this list into
[07](07-feedback-discoverability.md).
