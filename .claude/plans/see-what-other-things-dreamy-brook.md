# Performance Overhaul — vscode-scrcpy

## Context

The extension works, but performance was never designed — it accreted. An audit of the whole
repo (video hot path, extension host, webview React, packaging) found ~25 concrete issues.
Three structural ones dominate:

1. **Every H.264 frame is base64-encoded, batched behind a fixed 8 ms timer, then decoded byte-by-byte
   in JS on the webview main thread.** ~6–8 full-payload copies per frame, +33 % IPC bytes, +8 ms
   latency, and — because the batch concatenates whatever arrived in the window — multiple access
   units get merged into a single `EncodedVideoChunk`, which loses frames under jitter. `engines.vscode`
   is already `^1.85.0`, so raw `ArrayBuffer` transfer has been available the whole time.
2. **Work continues when nothing is visible.** `ScrcpyPanel` has no `onDidChangeViewState` handler at
   all; `LogcatPanel`/`ShellLogsPanel` keep streaming logcat into hidden webviews. All five surfaces
   set `retainContextWhenHidden: true`.
3. **ADB is driven by process spawns.** `ScrcpyService` holds a live ADB socket, but six other services
   each `spawn('adb')` per call — including a 5 s poll that spawns 6–7 processes per tick, and an app
   list that spawns 250–400 `dumpsys package` processes.

Goal: cut end-to-end mirror latency, eliminate idle CPU, and make the log/file views usable at scale —
in independently shippable, independently revertible phases.

**Decisions made with the user:** full scope; ADB socket reuse included behind a spawn fallback;
verification is manual on a real device (no test suite exists and none is being added here).

---

## Constraints that shape the design

- `media/webview.html:6` CSP is `default-src 'none'` with **no `worker-src`/`child-src`** → decoding
  cannot move to a Worker. All webview work stays on the main thread, so reducing main-thread work is
  the only lever. `script-src {{cspSource}}` **does** permit dynamic-import chunks from the extension
  root, so Vite code-splitting is viable.
- `@types/vscode` index.d.ts L9968-9976: for `engines.vscode >= 1.57`, **`ArrayBuffer`** values in
  `postMessage` transfer efficiently and are recreated as `ArrayBuffer`. TypedArrays are *not*.
  `Buffer.concat(...).buffer` is a pooled slab — always `.slice()` to exact bounds.
- `value.data` from the scrcpy stream is a `subarray` **view into a shared socket read buffer**
  (`@yume-chan/stream-extra/esm/buffered.js`). It must be copied synchronously inside the callback and
  can never be retained. One host-side copy is mandatory.
- `webview-ui` builds with `noUnusedLocals`/`noUnusedParameters` — deleted refs must actually be removed.
- `webview-ui/src/types/index.d.ts` is a stale generated artifact still declaring `video.data: string`.
  TS prefers `index.ts` in the same dir, so it is inert. **Do not update it; do not be confused by it.**

---

## Track 1 — Video pipeline (highest perceived win)

Files: `src/services/ScrcpyService.ts`, new `src/services/VideoFrameForwarder.ts`,
`src/views/ScrcpySidebarView.ts`, `src/panels/ScrcpyPanel.ts`,
`webview-ui/src/hooks/useVideoDecoder.ts`, `webview-ui/src/apps/MirrorApp.tsx`,
`webview-ui/src/types/index.ts`.

### 1A. Extract `VideoFrameForwarder`, preserving today's exact semantics

`ScrcpySidebarView.ts:472-509` and `ScrcpyPanel.ts:305-336` are near-identical copies of the buffer +
8 ms timer + base64 logic. Extract first, change behaviour later — so a later regression is
attributable to the wire format, not to a botched call site.

```ts
export class VideoFrameForwarder {
    constructor(options: {
        postMessage: (message: unknown) => Thenable<boolean> | void;
        isDeliverable: () => boolean;      // false when the webview can't usefully render
        requestKeyFrame: () => void;       // ScrcpyService.requestKeyFrame, bound
        onWarn?: (message: string) => void;
    });
    readonly handlePacket: (packet: ScrcpyVideoPacket) => void;  // bound arrow property
    setSaturated(saturated: boolean): void;
    resync(): void;      // absorbs ScrcpySidebarView._resyncVideoStream (L982-990)
    reset(): void;       // from _stopStreaming() / dispose()
    getStats(): { forwarded: number; droppedSaturated: number; droppedHidden: number };
}
```

Reuse the existing `_resyncVideoStream` body (`ScrcpySidebarView.ts:982-990`) as `resync()`; the
sidebar visibility handler at L140 keeps calling it unchanged.

**Fix shipped in this phase:** the 2 MB overflow path (`ScrcpySidebarView.ts:480-490`,
`ScrcpyPanel.ts:308-315`) currently clears the buffer — possibly discarding SPS/PPS/IDR — **without**
posting `video-reset` or calling `requestKeyFrame()`, leaving the stream corrupt until the next
scheduled keyframe (~10 s). Replace with a single invariant in the forwarder:

```ts
private drop(): void {
    if (this.dropUntilKeyframe) return;
    this.dropUntilKeyframe = true;
    this.resync();                   // video-reset + requestKeyFrame(), exactly once
}
```
`handlePacket` forwards nothing while `dropUntilKeyframe` is set, until it sees a keyframe. This one
flag uniformly covers saturation, hidden-view gaps, and panel occlusion.

### 1B. Rewrite the host read loop

`ScrcpyService.processVideoStream` (L217-308) wraps every `reader.read()` in `readWithTimeout` — a
fresh Promise + closure + `setTimeout` + `clearTimeout` + `addEventListener`/`removeEventListener`
pair **per packet** (~8 allocations × 60/s).

It also has a real bug: on the 10 s timeout it rejects but never cancels the underlying `read()`, and
the catch at L286-289 does `continue` — issuing a *second* read while the first is pending. When data
finally arrives the orphaned read swallows a packet. If that packet is config or an IDR, the picture
freezes for a GOP.

Replace with: one long-lived `NodeJS.Timeout` refreshed via `stallTimer.refresh()` per packet, and one
`abortSignal` listener that calls `reader.cancel()` (the stream is native WHATWG, so `cancel()` settles
the in-flight `read()` with `{done:true}` — no Promise race needed). Per-packet cost: ~8 allocations → 1
`refresh()`.

### 1C. Framed binary transport — the big one

**Wire format — one message per access unit, no custom binary header:**

```
{ type: 'video-config', data: ArrayBuffer }                 // SPS+PPS, Annex-B
{ type: 'video', k: 0 | 1, pts: number, data: ArrayBuffer } // exactly one access unit
{ type: 'video-reset' }                                     // unchanged
```

Chosen over a batched header format because `sendFrameMeta: true` (`ScrcpyService.ts:159`) already
delivers **exactly one access unit per packet** — so there is nothing to batch except latency. The
current 8 ms timer fires at up to 125 Hz, so one message per AU is *fewer* messages than today, not
more. And batching is precisely what causes the multi-AU merge bug.

Delete all batching state: `ScrcpySidebarView.ts` L23-25, L34-35, L478-509, L555-560; `ScrcpyPanel.ts`
L21-23, L28-29, L306-335, L373-378.

**Metadata passthrough.** `ScrcpyService.ts:275-277` currently discards `value.keyframe` and `value.pts`,
and forwards the `configuration` packet as an anonymous blob that the webview only recovers by NAL
scanning. Change the events interface (breaking rename makes missed call sites a compile error):

```ts
export type ScrcpyVideoPacket =
    | { type: 'config'; data: Uint8Array }
    | { type: 'frame'; data: Uint8Array; keyframe: boolean; pts: number };
// ScrcpyServiceEvents.onVideoData  ->  onVideoPacket
```
`pts` is `number` µs, not `bigint` (bigint is not cloneable through VS Code's postMessage path).
Rebase against a `ptsBase` field, reset in `stop()` and at the top of `processVideoStream`, so a
`resetVideo()` that restarts the encoder can't produce a backwards jump.

**Black-screen hazard this introduces, and its two-part fix.** With SPS/PPS moved out of band, losing
the single `video-config` message means a permanent black screen. `MirrorApp.tsx:88-91` gates video on
`statusRef.current === 'connected'`, and `statusRef` is only assigned during render (L79) — while
`onConnected()` fires at `ScrcpyService.ts:195` *before* streaming starts at L198. So the config packet
can legitimately be dropped. Fix both ends:
1. The forwarder caches `lastConfig` and **prepends it to every keyframe**, making each IDR
   self-sufficient (this also deletes the webview's per-keyframe SPS+PPS concat).
2. `MirrorApp.tsx` handles `video-config`/`video` **unconditionally** — the decoder hook's own state
   machine already ignores frames before configuration.

**Webview simplification.** `useVideoDecoder.ts` loses, in full:
`atob` + the `charCodeAt` scalar loop (L192-207), `decodeBufferRef` (L103), `splitNalUnits` (L45-86),
the per-keyframe access-unit rebuild (L305-331), the synthesized-timestamp block (L333-342), and the
ad-hoc decoder-recovery block (L250-278). What remains: `parseSPS` (unchanged), `getNalType`, and a new
`findNal(data, type)` that runs **once per stream** on the config blob and returns a `subarray` view.

Copies per frame, before → after: `Buffer.from` ✗, `Buffer.concat` ✗, base64 encode ✗, `atob` ✗,
`charCodeAt` loop ✗, per-NAL `slice` ✗, access-unit rebuild ✗ (delta frames). Added: one mandatory
host-side `.slice()` to exact `ArrayBuffer` bounds. **`new EncodedVideoChunk({data})` always copies
internally per spec — that one is unavoidable**, so the floor is one webview copy, and this hits it.

Guard defensively once per session: `if (!(buf instanceof ArrayBuffer)) { log; return; }`.

### 1D. rAF present loop with a single latest-frame slot

`renderFrame` is wired directly as the decoder `output` callback (`useVideoDecoder.ts:158-163`) — no
pacing. Since `desynchronized: true` 2D still presents at vsync, drawing early buys **zero** perceived
latency; it only front-loads main-thread work. rAF pacing buys three real things: bounded compositing
when `maxFps` exceeds refresh rate; burst absorption after a stall (render newest, close the rest); and
one exception-safe `close()` site.

`frame.close()` at L142 is **not** in a `try/finally` — if `drawImage` throws (canvas detached during a
device-skin remount, `MirrorApp.tsx:356`), the `VideoFrame` leaks, and ~4 leaks stall the decoder
permanently. This is a live bug.

```ts
const present = () => {
    rafRef.current = null;
    const frame = pendingFrameRef.current;
    pendingFrameRef.current = null;
    if (!frame) return;
    try {
        // NOTE: the videoSizeRef / canvas.width update block MUST move here with the draw.
        ctx.drawImage(frame, 0, 0);
    } finally { frame.close(); }
};
const onDecoderOutput = (frame: VideoFrame) => {
    const stale = pendingFrameRef.current;
    pendingFrameRef.current = frame;
    stale?.close();                                    // at most one live frame, ever
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(present);
};
```
`reset()` and an unmount cleanup must both `cancelAnimationFrame` and close the pending slot.

⚠️ **Highest-consequence regression risk in the whole plan:** `getVideoSize()` (L376) reads
`videoSizeRef`, which is written inside the render path, and `VideoCanvas.updateRenderGeometry`
(`VideoCanvas.tsx:164-183`) depends on it. If the size-update block isn't carried into `present()`,
geometry stays null and **every touch is silently dropped**. Test touch explicitly, skin on and off.

### 1E. Decoder configuration

`configure({ codec, optimizeForLatency: true })` (L175-178) sets no acceleration hint and never calls
`isConfigSupported`. Add a small async state machine (`'idle' | 'configuring' | 'ready' | 'failed'`
replacing the `decoderConfiguredRef` boolean) that walks candidates
`prefer-hardware` → `no-preference` → bare, checking `isConfigSupported` on each, then requests a
keyframe (frames dropped while awaiting).

**Keep Annex-B; do not switch to avcC/`description`.** That would require rewriting every access unit
from start codes to length prefixes on every frame — strictly worse than what's being removed.

`prefer-hardware` can report supported and still fail at runtime (throw, error callback, or green
frames). Sticky fallback in the decoder `error` callback: flip `accelRef` to `'no-preference'` for the
session, set state back to `'idle'`, request a keyframe. Because the host prepends config to keyframes,
recovery is one round trip rather than one GOP.

### 1F. Backpressure + panel visibility gate

Move the drop check to the **first statement** of the frame handler — with `keyframe` now a message
field it's a field read, no parsing needed. Today's check (L286-303) runs *after* `atob`, the byte
loop, and a full NAL scan, i.e. it does all the work and then throws it away.

Add an upstream signal with hysteresis + rate limiting so it can't itself flood
(`enter: queueSize > 6 on two consecutive frames; leave: <= 2; min 250 ms between posts`):

```ts
| { command: 'video-backpressure'; saturated: boolean }
| { command: 'video-request-keyframe' }
```
Host cases go next to the existing switch at `ScrcpySidebarView.ts:288` / `ScrcpyPanel.ts:184`;
`video-request-keyframe` maps to the existing `ScrcpyService.requestKeyFrame()` (L471).

**`ScrcpyPanel` has no visibility handling at all** — grep for `onDidChangeViewState` across `src/`
returns zero hits, despite `retainContextWhenHidden: true` (L47). A backgrounded mirror tab keeps the
scrcpy socket, the read loop, the encode+IPC path, *and* the 5 s device-info poll fully hot. Add:

```ts
this._panel.onDidChangeViewState(() => {
    if (this._panel.visible) this._videoForwarder?.resync();
}, null, this._disposables);
// with isDeliverable: () => this._panel.visible
```

---

## Track 2 — Extension host: idle CPU and ADB transport

### 2A. Stop work in hidden surfaces

- `LogcatPanel.ts` / `ShellLogsPanel.ts`: no visibility handling — the `logcat` child process keeps
  running, parsing, and posting into a hidden webview. Add `onDidChangeViewState` to pause the stream
  (or at minimum stop forwarding) while hidden, resuming on reveal.
- Drop `retainContextWhenHidden: true` for `FileManagerPanel.ts:37`, `ShellLogsPanel.ts:39`,
  `LogcatPanel.ts:36` — none holds a decoder or canvas, and each permanently retains a full React tree.
  Keep it for the sidebar (`extension.ts:33`, needed for Persistent Mirroring, documented at L24-29) and
  for `ScrcpyPanel.ts:47`.

### 2B. Batch logcat IPC (~50× fewer messages)

`AdbLogcatService.flushPendingLogs` (L182-188) throttles correctly at 100 ms / 50 entries, then
**unrolls the batch back into per-entry callbacks**, and `LogcatPanel.ts:60-62` /
`ShellLogsPanel.ts:64-66` post each one separately. Up to 50 discrete `postMessage` calls per 100 ms,
each a full structured clone — and on the webview side, up to ~500 renders/sec (see 3A).

Change `onLogEntry(entry)` → `onLogEntries(entries: LogcatEntry[])` and post one
`{ type: 'logcat-batch', entries }` per tick. Webview appends the whole array in one `setState`.

Also: `applyGrouping` (L453-497) computes `isStackTraceLine` (5 regexes, L417-433) **unconditionally**
at L455 before the `isErrorEntry` guard at L456 — hoisting it behind the guard is free. And prune the
unbounded `pidToPackage` map (L50) and `currentCrashBuffer` (L47).

### 2C. `AppManager` — replace 250–400 process spawns with 2

`getInstalledApps()` (L74-108) runs one `adb shell dumpsys package <pkg>` **per package** (L283), 20
concurrent. `getDebugApps()` (L190-255) is worse: it dumps every package to test the DEBUGGABLE flag
(L211), then re-dumps each hit via `getAppInfo` (L225 → L283).

Replace with `pm list packages -3 --show-versioncode` plus a single `cmd package dump` (or one
`dumpsys package` pass) parsed once. Also: `debugAppsCache` (L247) and `recentAppsCache` (L180) are
**written and never read** — wire them up, and let `appCache` (L22) short-circuit `getInstalledApps()`
rather than only being populated after the expensive scan.

### 2D. `DeviceInfoService` — tier the poll, cache the immutable

The 5 s interval (L51-59) fires 6–7 spawns per tick (~72–84/min while mirroring). Three of them
(`ro.product.model`, `ro.build.version.release`, `ro.build.version.sdk`) are **immutable per device**
and re-fetched forever. `dumpsys wifi` / `dumpsys connectivity` are among the heaviest dumpsys targets.

- Cache the three immutable props per device id, fetch once.
- Tier: battery every 5 s; network/storage every 30–60 s.
- Gate the interval on webview visibility. Today it keeps running in sidebar persistent-hidden mode
  (the hidden branch at `ScrcpySidebarView.ts:166` is guarded by `!this._persistentMirroringEnabled`)
  and always in `ScrcpyPanel`.

### 2E. `DeviceManager.getPreferredDevice()` — called on nearly every UI action

L322-338 calls `enumerateDevices()` **twice** when the remembered device is gone, and each call is
`adb devices -l` plus up to 4 *sequential* `adb shell` spawns per device on a name-cache miss
(`_resolveDeviceName`, L139-180). It has ~20 call sites (volume, lock, camera, paste, install…), so a
single "Volume Up" can cost 3 spawns.

Fix the double-enumerate, and add a short-TTL cached "current device" field consulted first (the code
already tries `_scrcpyService?.getCurrentDeviceId()` at `ScrcpySidebarView.ts:612` — generalize that).

### 2F. ADB socket reuse, behind a spawn fallback

`ScrcpyService` already holds a live `Adb` handle over `127.0.0.1:5037` and demonstrates the pattern at
L524 (`adb.subprocess.noneProtocol.spawnWait(['screencap','-p'])`). Meanwhile
`AdbPathResolver.getAdbCommand()` returns the literal `'adb'` and seven services shell out to it.

Introduce one `AdbCommandRunner` abstraction with two backends:
- **socket** — reuse the active `Adb` handle when a stream is live (zero process spawn);
- **spawn** — today's `child_process` path, used when no handle exists.

Migrate consumers in order of payoff: `DeviceInfoService` → `AppManager` → `AdbShellService` one-shots
→ `DeviceFileService`. Each migration is independently revertible; the fallback means nothing breaks
when mirroring is off. Note `AdbPathResolver.ts:67` also passes `shell: true` on Windows, adding a
`cmd.exe` layer to the version probe.

Also worth fixing while here: `injectTouch`/`injectKeyCode`/`injectScroll` are called **unawaited**
inside `try/catch` blocks that cannot catch async rejections (`ScrcpyService.ts:364`, `:401`, `:452`)
— a disconnect mid-gesture produces unhandled rejections and silently swallowed input.
`requestKeyFrame` at L478 already does it right (`.catch(console.error)`); match that.

---

## Track 3 — Webview React

### 3A. Virtualize the log lists (biggest webview win)

`EnhancedLogsPanel.tsx:472-493` and `LogsPanel.tsx:399-410` render **all** retained entries — capped at
2000 (`LogcatApp.tsx:32-35`, `ShellLogsApp.tsx:69-72`) — as real DOM, ~6 elements each ≈ 12 000 nodes
reconciled *per appended line*. Combined with 2B's per-line messages, that's up to ~500 full renders/sec.

- Add windowing (a small hand-rolled windowed list is enough; no dependency exists today and the rows
  are fixed-ish height). Render only the visible slice plus overscan.
- `EnhancedLogEntryRow` (L44) and `LogEntryRow` (L94) are **not** `memo`'d — and memo would be a no-op
  anyway because `highlight={{ query, useRegex, caseSensitive }}` (L484-488) allocates a new object per
  row per render. Hoist that object to one `useMemo` in the parent, then memo the rows.
- Search input has **no debounce** (`EnhancedLogsPanel.tsx:373-375`, `FileManagerApp.tsx:420-425`).
  Each keystroke = 2000 iterations × 2 `toLowerCase()` allocations (L146-147) + 2000 rows re-rendered
  with 2000 `new RegExp` constructions (`EnhancedLogEntryRow.tsx:23-38`). Debounce ~120 ms and make
  `filters.levels` a `Set` instead of `Array.includes` (L143).
- Counters do 3 extra full passes per append: `levelCounts` (L160-171) plus `errorCount`/`warningCount`
  (`LogcatApp.tsx:106-112`, which allocate arrays just to count). Maintain incrementally on append.
- `streamRef.current.scrollTop = streamRef.current.scrollHeight` (L81-86) forces sync layout per append.

`FileManagerApp.tsx:476-520` has the same shape — unvirtualized listing, 3 new closures per row per
render, undebounced filter.

### 3B. Kill the pan/zoom render storm

Per `pointermove` during a pan, the mirror view does **2 React renders + 2 forced synchronous layouts**
interleaved with `drawImage` on the same main thread:

- `useZoom.ts:104-105` reads `offsetWidth`/`clientWidth` **inside the `setPan` updater** → forced layout
  during React's render phase.
- `MirrorApp.tsx:347-349` is a `setState`-in-effect on `[showDeviceSkin, zoom, panX, panY]` → a second
  commit per frame, and the resulting `invalidateCacheKey` prop (L417, L437) defeats `memo()` on
  `VideoCanvas` (L40) every frame.
- `VideoCanvas.tsx:147-161` then calls `getBoundingClientRect()` — a third layout.

Fix: drive pan/zoom through a ref + CSS transform written imperatively (no React state per move),
commit to state only on pointer-up; compute clamp bounds from cached measurements rather than reading
layout inside a state updater; drop the `canvasCacheKey` effect. Preserve the existing
`key={deviceSkinKey}` remount guard (`MirrorApp.tsx:338-340`) — the comment at L344-346 correctly warns
that `canvasCacheKey` must never be used as `key`.

### 3C. Prop-identity fixes

`Toolbar` is `memo`'d (L57) but receives ~11 fresh inline arrows from `MirrorApp.tsx:465-510`, so memo
never hits. Same for `DeviceSelector` (memo'd at L41) across `LogcatApp.tsx:151-155`,
`ShellLogsApp.tsx:199-203`, `FileManagerApp.tsx:333-337` — and `DeviceSelector.tsx:57-60` has
`useEffect(..., [isOpen, onRefresh])`, so an unstable `onRefresh` re-fires it and re-posts
`get-device-list`. Wrap the handlers in `useCallback`.

Also: `Toolbar.tsx:105-114` registers a second always-on `window` message listener that runs for
**every video packet** just to reset one boolean — fold it into the app's existing handler.
`unstable_batchedUpdates` (`MirrorApp.tsx:2`, used at L85) is a React-17 shim and a **no-op** under
`createRoot`; remove it. And `useVSCodeMessages.ts:14` re-posts `ready` whenever the effect
re-subscribes — make the listener registration independent of the callback identity (ref indirection)
so a future dep change can't retrigger extension-side init.

### 3D. Code-split the bundle

`vite.config.ts` forces `entryFileNames: 'webview.js'` with a single entry, and `App.tsx:1-4` statically
imports all four apps. Result: one 272 KB chunk + one 62 KB stylesheet, and the small sidebar parses
`FileManagerApp`, `LogcatApp`, `ShellLogsApp`, `SettingsPanel` (1053 lines), `MorePanel` (761 lines) and
all 63 lucide icons before it can show anything.

Switch the four apps to `React.lazy` + per-view CSS imports so each panel loads only its own code.
CSP permits this (`script-src {{cspSource}}`); set Vite `base` so emitted chunk URLs resolve relative to
`media/build/`. Verify each panel still boots — this is the one change that can white-screen a view.

---

## Track 4 — Activation and packaging

- **Lazy-load the protocol stack.** `@yume-chan/*` is ~267 KB / 63 % of the extension bundle and is
  evaluated at `require()` time because `extension.ts:2` → `ScrcpyPanel` → `ScrcpyService.ts:3-17` are
  all static imports. Its only consumer is `ScrcpyService`. Load it via
  `await import('../services/ScrcpyService')` inside `_startStreaming()`. The codebase already does
  this for `LogcatPanel` (`ScrcpySidebarView.ts:247`, `ScrcpyPanel.ts:156`) but then defeats it with a
  static import at `extension.ts:6` — fix that too.
- **The shipped VSIX contains the dev build.** `vscode-scrcpy-1.1.1.vsix` holds a 416 KB *unminified*
  `dist/extension.js` (13 084 lines, unmangled `__create`/`__defProp` prologue, `sourceMappingURL`
  footer) plus an **894 KB `extension.js.map`** — despite `.vscodeignore` L14/17/18 excluding maps,
  which `!dist/**` at L16 overrides. Fix the ignore ordering and verify the packaged bundle is minified.
- **~1.65 MB of README JPEGs** ship inside the VSIX (`images/**` is absent from `.vscodeignore`), plus
  `CLAUDE.md`. Exclude them, or reference the screenshots by raw GitHub URL from the README.
- Add `metafile: true` to `esbuild.js` for bundle-size visibility.
- Drop the 5 redundant `onCommand:*` entries in `package.json:31-38` — VS Code ≥1.74 generates command
  activation from `contributes.commands`; the real trigger is `onView:scrcpySidebar`.
- Also worth removing: the unconditional `await new Promise(r => setTimeout(r, 500))` on every
  hidden→visible resume (`ScrcpySidebarView.ts:147`).

---

## Suggested landing order

Each row is one commit, independently revertible. Track 1 first — it owns the headline metric and the
riskiest change, so it gets the freshest attention.

| # | Phase | Risk |
|---|---|---|
| 1 | 1A extract forwarder (same semantics) + overflow-resync fix | low |
| 2 | 1B read-loop rewrite | low, host-only |
| 3 | 2A hidden-surface gating + 1F panel `onDidChangeViewState` | low, big idle-CPU win |
| 4 | 2B logcat batch IPC | low |
| 5 | 3A log virtualization + debounce + row memo | medium, webview-only |
| 6 | **1C framed ArrayBuffer transport** (host + webview must ship together) | **high** |
| 7 | 1D rAF present loop + exception-safe `close()` | medium |
| 8 | 1E decoder config + hardware fallback | medium |
| 9 | 1F backpressure signal | low |
| 10 | 2C AppManager, 2D DeviceInfoService, 2E getPreferredDevice | medium |
| 11 | 2F AdbCommandRunner + socket backend, migrated service by service | medium |
| 12 | 3B pan/zoom, 3C prop identity | medium |
| 13 | 3D code-splitting, Track 4 activation + packaging | medium |

---

## Verification

No test suite exists; verification is manual in the Extension Development Host (F5, or
`npm run dev` → `scripts/launch.js`) against a real device. Webview console via
**Developer: Open Webview Developer Tools**.

**Take a baseline before phase 1:** run 60 s, note the `Rendered N frames` cadence (temporarily
re-enable `addLog` — `MirrorApp.tsx:69-71` currently stubs it to a no-op), and eyeball latency by
mirroring a device stopwatch against a wall clock.

Per phase:
- **1A** — start/stop from both the sidebar *and* `Scrcpy: Start Screen Mirror` (the panel path,
  `extension.ts:37-39`). Toggle Persistent Mirroring, hide/show the sidebar in each state; expect
  byte-identical behaviour. Force the overflow path (temporarily set `MAX_VIDEO_BUFFER_SIZE` to 64 KB)
  and confirm the picture **recovers** instead of staying corrupt.
- **1B** — screen off >15 s then wake: no lost/garbage frame, no timeout spam. Stop mid-stream: clean
  exit, no unhandled rejection in the Debug Console.
- **2A / 1F** — with a mirror panel in a background tab and a logcat panel hidden, confirm host CPU
  drops to idle; confirm clean resume on reveal.
- **2B / 3A** — run a chatty logcat (`am start` a heavy app). Confirm the UI stays responsive at 2000
  retained lines, typing in the search box doesn't stutter, and autoscroll still tracks.
- **1C** — config arrives and the canvas lights up within ~1 s of `connected`. Scroll a long list,
  switch apps, **rotate the device** (exercises `sizeChanged`, `ScrcpyService.ts:189-192`).
  **Test touch accuracy at the screen corners with the device skin both on and off.** Zero decode
  errors in the webview console. Stutter under motion should be visibly gone.
- **1D** — 5 min with no *"A VideoFrame was garbage collected without being closed"* warning. Toggle the
  device skin repeatedly (canvas remount): no leak, no stall. Frame cadence ≈ `maxFps`, not above.
- **1E** — read the logged codec + acceleration line. Force the fallback by reordering candidates;
  confirm software decode renders. Force the error path; confirm sticky fallback recovers in ~1 s.
- **1F** — CPU-throttle in webview devtools: `video-backpressure` fires **once** on entry (not per
  frame), picture degrades to keyframes-only, recovers cleanly.
- **2C–2F** — open the app list and time it; watch Task Manager for `adb.exe` spawn churn during a 60 s
  mirror session. Confirm every ADB-dependent feature still works with mirroring **off** (spawn
  fallback) and **on** (socket backend).
- **3B / 3C** — profile a pan in webview devtools: expect one commit per pointer-move, no forced-layout
  warnings, `VideoCanvas` no longer re-rendering per frame.
- **3D** — open all four views from a packaged build and confirm none white-screens (CSP + chunk URLs).

Gate every phase on:
```
npm run typecheck && npm run lint && npm run format:check
cd webview-ui && npm run build
```

---

## Explicitly out of scope

- **Worker/OffscreenCanvas decoding** — blocked by the CSP at `media/webview.html:6` (`default-src
  'none'`, no `worker-src`, no `blob:` workers). Would need a CSP change; not part of this work.
- **WebGL/WebGPU rendering** — 2D `drawImage` from a `VideoFrame` is already a GPU path in Chromium;
  the rAF slot (1D) captures the available win without a renderer rewrite.
- **Adding Vitest** — user chose manual verification. `webview-ui/src/types/index.d.ts` deletion is a
  separate unrelated cleanup.
- **avcC/`description` decoder mode** — analyzed and rejected in 1E; it would add per-frame work.
