# Changelog

All notable changes to the "VS Code Scrcpy" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [1.0.0] - 2025-12-XX

### Initial Release

- Android device screen mirroring directly in VS Code
- Touch controls support (tap, swipe, pinch-to-zoom)
- Device file manager
- ADB shell interface
- Logcat viewer
- App management (launch, list installed apps)
- Quality and FPS settings
- Cross-platform ADB path detection
