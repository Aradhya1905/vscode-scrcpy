# Changelog

## [1.2.0] - 2026-08-09

Introduces an independent zoom and pan control, direct-to-clipboard screenshot
capture, and a broad performance overhaul spanning the video pipeline, log viewers,
and every ADB operation performed by the extension.

### 🔍 Zoom & Pan

Closes [#3](https://github.com/Aradhya1905/vscode-scrcpy/issues/3). The extension now
provides its own zoom control.

![Dedicated zoom control](https://raw.githubusercontent.com/Aradhya1905/vscode-scrcpy/main/images/zoom-button.png)

- **Zoom HUD**: `+` / `−` controls with a live percentage readout and a **Reset**
  action. The HUD fades 2.5s after the last change and remains visible while the
  pointer hovers over it.
- **Standard zoom steps**: the browser-standard ladder (100% → 110% → 125% → 133% …),
  spanning **25% to 400%**.
- **Ctrl + scroll wheel** zooms toward the pointer rather than scrolling the device.
- **Alt + left-drag** and **middle-drag** pan the zoomed view. The cursor changes to a
  grab handle as soon as Alt is pressed to indicate that panning is armed.
- **Zoom level persists** across sessions.

Pan and zoom are applied imperatively rather than through React state, so dragging a
zoomed view incurs no re-renders or layout thrash.

### 📸 Clipboard Screenshots

- The capture action now **copies the screenshot to the system clipboard** and
  confirms with a toast, removing the save dialog from the capture flow.
- The icon animates for the duration of the capture to indicate progress.
- Captures always use full device resolution, independent of the mirror quality
  setting.

### ✨ Features

- **Persistent mirroring**: an opt-in setting that keeps the mirror session alive
  while the sidebar is hidden, allowing an instant resume instead of a full
  reconnect.
- **Responsive device skins**: the phone frame now scales to the available panel
  space instead of a fixed 630px width.
- **Reworked toolbar and empty states**: clearer connection status with dedicated
  surfaces for the disconnected, connecting, and error cases.
- **Theme-aware styling**: the UI now follows the active VS Code theme through a
  design-token layer.

### ⚡ Performance

This release reworks how video, logs, and ADB traffic move through the extension.

**Video pipeline**

- Frames are transferred as raw `ArrayBuffer`s, one per access unit, eliminating the
  base64 encoding hop and per-byte decoding on the main thread.
- Presentation is paced on `requestAnimationFrame`, and every `VideoFrame` is
  explicitly closed, resolving a steady GPU memory leak during long sessions.
- The webview reports decode-queue saturation to the extension, which falls back to
  keyframes only until the queue recovers, degrading quality gracefully rather than
  accumulating latency.
- The decoder probes for a supported configuration instead of assuming one, fixing
  black-screen starts on some devices.
- A single stream watchdog replaces the previous per-packet read timeout.

**ADB and device data**

- One-shot ADB commands reuse the **existing mirror connection** while streaming,
  avoiding a new process, handshake, and reconnect per command.
- The installed-app list is built from **two** ADB calls instead of one per package,
  reducing a multi-second stall to near-instant.
- Device-info polling is tiered, and the device list is no longer re-enumerated on
  every poll.

**Logs and rendering**

- Logcat and shell log lists are **virtualized**, with debounced search and memoized
  rows, keeping long log sessions responsive.
- Logcat entries are batched into a single IPC message per tick rather than one
  message per line.

**Startup**

- Views and the scrcpy protocol stack are loaded **on demand**, so activating the
  sidebar no longer parses the full protocol bundle up front.
- Hidden webview surfaces suspend work entirely instead of rendering off-screen.

### 🐛 Bug Fixes

- Fixed the video decoder failing to resync when persistent mirroring resumed.
- Fixed the device skin being sized to a hardcoded 630px instead of the panel.
- Fixed a stream resync gap following buffer overflow.

### 🧹 Removed

- **Network Inspector** placeholder. Capturing app traffic requires a MITM proxy and
  a trusted CA, and Android 7+ applications ignore user-installed CAs. The feature
  could not work as intended for the relevant apps, so the placeholder entry has been
  removed rather than left pending.

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
