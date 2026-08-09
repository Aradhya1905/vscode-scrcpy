# Changelog

## [1.2.0] - 2026-08-09

The biggest release so far: a real zoom control, screenshots that land straight on
your clipboard, and a top-to-bottom performance pass that touches the video path,
the log viewers, and every ADB call the extension makes.

### 🔍 Dedicated Zoom & Pan

Closes [#3](https://github.com/Aradhya1905/vscode-scrcpy/issues/3) — the mirror no
longer leans on VS Code's own display scaling. It has its own zoom.

![Dedicated zoom control](https://raw.githubusercontent.com/Aradhya1905/vscode-scrcpy/main/images/zoom-button.png)

- **Zoom HUD** — `+` / `−` buttons with a live percentage readout and a **Reset**
  button. It fades out 2.5s after your last change and stays put while your pointer
  is over it.
- **Familiar zoom steps** — the same ladder Chrome and Edge use (100% → 110% → 125%
  → 133% …), from **25% up to 400%**.
- **Ctrl + scroll wheel** zooms toward the pointer instead of scrolling the device.
- **Alt + left-drag** or **middle-drag** pans the zoomed view. The cursor switches to
  a grab handle the moment Alt goes down, so you can see the pan is armed.
- **Your zoom level is remembered** across sessions.

Pan and zoom are driven imperatively rather than through React state, so dragging
around a zoomed screen costs no re-renders and no layout thrash.

### 📸 Screenshots Straight to the Clipboard

- The camera button now **copies the screenshot to your clipboard** and shows a
  confirmation toast — no more save dialog interrupting every capture.
- The icon spins while the capture is in flight, so you know it's working.
- Captures at full device resolution, independent of your mirror quality setting.

### ✨ Features

- **Persistent Mirroring** — a settings toggle that keeps the mirror session alive
  when the sidebar is hidden, so switching away and back resumes instantly instead
  of reconnecting.
- **Device skins fit the panel** — the phone frame now scales to whatever space the
  panel has, instead of being pinned to a fixed 630px.
- **Reworked toolbar and empty states** — clearer connection status and dedicated
  surfaces for the disconnected, connecting, and error cases.
- **Theme-aware styling** — the UI now follows your VS Code theme through a proper
  design-token layer.

### ⚡ Performance

This release reworks how video, logs, and ADB traffic move through the extension.

**Video pipeline**

- Frames travel as raw transferable `ArrayBuffer`s, one per access unit — no base64
  hop, no per-byte decoding on the main thread.
- Presentation is paced on `requestAnimationFrame`, and every `VideoFrame` is
  explicitly closed, removing a steady GPU memory leak during long sessions.
- The webview now tells the extension when its decode queue is saturated; the
  extension drops to keyframes only until it recovers, so the picture degrades
  gracefully instead of falling behind.
- The decoder probes for a working configuration instead of assuming one, fixing
  black-screen starts on some devices.
- A single stream watchdog replaces the per-packet read timeout.

**ADB & device data**

- One-shot ADB commands ride the **existing mirror connection** while streaming —
  no new process, no handshake, no reconnect per command.
- The installed-app list is rebuilt from **two** ADB calls instead of one per
  package, cutting a multi-second stall down to a blink.
- Device-info polling is tiered, and the device list is no longer re-enumerated on
  every tick.

**Logs & rendering**

- Logcat and shell log lists are **virtualized**, with debounced search and memoized
  rows — long log sessions no longer bog the UI down.
- Logcat entries are batched into one IPC message per tick rather than one per line.

**Startup**

- Each view and the entire scrcpy protocol stack load **on demand**, so activating
  the sidebar no longer parses the full protocol bundle up front.
- Hidden webview surfaces stop doing work entirely instead of rendering into
  nothing.

### 🐛 Bug Fixes

- Fixed the video decoder failing to resync when persistent mirroring resumed.
- Fixed the device skin being sized to a hardcoded 630px rather than the panel.
- Fixed a stream resync gap after buffer overflow.

### 🧹 Removed

- **Network Inspector** placeholder. Capturing app traffic requires a MITM proxy and
  a trusted CA, and Android 7+ apps ignore user-installed CAs — it could never have
  worked for the apps people would point it at, so the "coming soon" entry is gone
  rather than left dangling.

## [1.1.0] - 2026-01-10

### ✨ Features

- **Clipboard Paste Support**: Added ability to paste clipboard content to connected Android devices
- **Quick Start Button**: Converted placeholder screen into a functional streaming button for faster mirror initiation
- **Connection Retry Logic**: Added automatic retry mechanism when connection to device is lost, improving reliability

### 🐛 Bug Fixes

- **Native Quality Resolution**: Fixed resolution scaling to properly support native device quality settings
- **Stream Cleanup**: Improved video stream cleanup and resource management to prevent memory leaks
- **UI Polish**: Removed unnecessary tooltip from play button in placeholder view for cleaner interface

### ⚡ Performance Improvements

- **Reduced Latency**: Set maxBframes=0 for lower latency video decoding, providing more responsive screen mirroring
- **Immediate Stream Termination**: Added AbortController for instant stream termination when stopping mirror or switching devices
- **Resource Leak Prevention**: Enhanced cleanup when switching between devices or stopping the mirror

## [1.0.0] - 2025-12-25

### Initial Release

- Android device screen mirroring directly in VS Code
- Touch controls support (tap, swipe, pinch-to-zoom)
- Device file manager
- ADB shell interface
- Logcat viewer
- App management (launch, list installed apps)
- Quality and FPS settings
- Cross-platform ADB path detection
