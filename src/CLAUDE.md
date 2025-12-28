# VS Code Scrcpy - Extension Source

**Technology**: TypeScript 5.3, Node.js, VS Code Extension API
**Entry Point**: [extension.ts](extension.ts)
**Parent Context**: This extends [../CLAUDE.md](../CLAUDE.md)

---

## Development Commands

### From Root Directory

```bash
# Watch mode (rebuilds on file changes)
npm run watch

# Type check
npm run typecheck

# Bundle for production
npm run bundle -- --minify

# Lint extension code
npm run lint
```

### Debugging

1. Press F5 in VS Code to launch Extension Development Host
2. Set breakpoints in any `.ts` file
3. Check Debug Console for `console.log` output

---

## Architecture

### Directory Structure

```
src/
├── extension.ts              # Entry point, command registration
├── services/                 # Core business logic (ADB, Scrcpy, etc.)
│   ├── ScrcpyService.ts      # Screen mirroring (500 lines)
│   ├── DeviceManager.ts      # Device discovery/selection
│   ├── AdbShellService.ts    # Shell command execution
│   ├── DeviceInfoService.ts  # Device metadata polling
│   ├── AppManager.ts         # App list, launch, recent apps
│   ├── DeviceFileService.ts  # File operations (push/pull/delete)
│   ├── ApkInstaller.ts       # APK installation
│   ├── AdbLogcatService.ts   # Logcat streaming
│   └── AdbPathResolver.ts    # Cross-platform ADB detection
├── panels/                   # Webview panels (floating windows)
│   ├── ScrcpyPanel.ts        # Mirror panel (can detach from sidebar)
│   ├── FileManagerPanel.ts   # File browser panel
│   ├── ShellLogsPanel.ts     # Shell/logs panel
│   └── LogcatPanel.ts        # Logcat viewer panel
└── views/                    # Sidebar view providers
    └── ScrcpySidebarView.ts  # Main sidebar (870 lines)
```

---

## Code Organization Patterns

### Service Pattern

Services handle core business logic with event-driven callbacks.

```typescript
// ✅ DO: Event-driven service pattern
export interface ScrcpyServiceEvents {
    onVideoData: (data: Buffer) => void;
    onError: (error: string) => void;
    onConnected: () => void;
    onDisconnected: () => void;
}

export class ScrcpyService {
    private events: ScrcpyServiceEvents;

    constructor(events: ScrcpyServiceEvents, extensionPath: string) {
        this.events = events;
        // ...
    }

    async start(deviceId?: string): Promise<void> {
        // Implementation
        this.events.onConnected();
    }
}
```

Example: [services/ScrcpyService.ts:18-47](services/ScrcpyService.ts#L18-L47)

```typescript
// ❌ DON'T: Return values for async events
// This makes it hard to handle streaming data
async start(): Promise<Buffer[]> {
    // Don't collect all video data before returning
}
```

### Panel Pattern

Panels extend `vscode.WebviewPanel` with static factory methods.

```typescript
// ✅ DO: Singleton panel pattern
export class FileManagerPanel {
    public static currentPanel: FileManagerPanel | undefined;

    public static createOrShow(context: vscode.ExtensionContext) {
        if (FileManagerPanel.currentPanel) {
            FileManagerPanel.currentPanel._panel.reveal();
            return;
        }
        // Create new panel...
        FileManagerPanel.currentPanel = new FileManagerPanel(panel, context);
    }

    public static kill() {
        FileManagerPanel.currentPanel?.dispose();
        FileManagerPanel.currentPanel = undefined;
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        // Private constructor, use createOrShow
    }
}
```

Example: [panels/FileManagerPanel.ts](panels/FileManagerPanel.ts)

### View Provider Pattern

Sidebar views implement `vscode.WebviewViewProvider`.

```typescript
// ✅ DO: Static revive pattern for sidebar
export class ScrcpySidebarView {
    public static currentView: ScrcpySidebarView | undefined;

    public static revive(webviewView: vscode.WebviewView, context: vscode.ExtensionContext) {
        ScrcpySidebarView.currentView = new ScrcpySidebarView(webviewView, context);
    }

    private constructor(view: vscode.WebviewView, context: vscode.ExtensionContext) {
        // Configure webview, set up message handlers
    }
}
```

Example: [views/ScrcpySidebarView.ts:35-37](views/ScrcpySidebarView.ts#L35-L37)

### Message Handler Pattern

Webview messages are handled with a switch statement.

```typescript
// ✅ DO: Exhaustive switch for message handling
this._view.webview.onDidReceiveMessage(
    async (message) => {
        switch (message.command) {
            case 'start':
                await this._startStreaming();
                break;
            case 'stop':
                this._stopStreaming();
                break;
            case 'touch':
                this._handleTouchEvent(message);
                break;
            // ... more cases
        }
    },
    null,
    this._disposables
);
```

Example: [views/ScrcpySidebarView.ts:157-256](views/ScrcpySidebarView.ts#L157-L256)

### Error Handling Pattern

```typescript
// ✅ DO: Catch errors and show VS Code messages
try {
    await this._scrcpyService.start(deviceId);
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to start: ${errorMessage}`);
    this._view.webview.postMessage({
        type: 'error',
        message: errorMessage,
    });
}
```

Example: [views/ScrcpySidebarView.ts:126-136](views/ScrcpySidebarView.ts#L126-L136)

---

## Key Files (Understand These First)

### Entry Point

- **[extension.ts](extension.ts)** - Registers commands and sidebar view provider
  - `activate()` - Called when extension loads
  - `deactivate()` - Called when extension unloads

### Core Services

- **[services/ScrcpyService.ts](services/ScrcpyService.ts)** - Screen mirroring engine
  - Uses @yume-chan/adb-scrcpy for protocol
  - Handles video streaming, touch input, key events
  - `start()`, `stop()`, `sendTouchEvent()`, `sendKeyEvent()`

- **[services/DeviceManager.ts](services/DeviceManager.ts)** - Device discovery
  - Polls ADB server for connected devices
  - Manages device selection state
  - `refreshDeviceList()`, `selectDevice()`, `getPreferredDevice()`

- **[services/AdbShellService.ts](services/AdbShellService.ts)** - Shell commands
  - Executes arbitrary ADB shell commands
  - Returns stdout, stderr, exit code
  - `executeCommand(deviceId, command)`

### Main UI Controller

- **[views/ScrcpySidebarView.ts](views/ScrcpySidebarView.ts)** - Sidebar orchestrator
  - Coordinates all services
  - Handles webview ↔ extension messaging
  - Manages video buffering and streaming

---

## Quick Search Commands

### Find Service Methods

```bash
# Find public async methods in services
rg -n "async \w+\(" services/

# Find event callback invocations
rg -n "this\.events\." services/

# Find ADB command execution
rg -n "executeCommand|spawnWait" services/
```

### Find Message Handlers

```bash
# Find webview message cases
rg -n "case '[a-z-]+'" views/ panels/

# Find postMessage calls
rg -n "postMessage\(" views/ panels/
```

### Find VS Code API Usage

```bash
# Find window API calls
rg -n "vscode\.window\." src/

# Find workspace API calls
rg -n "vscode\.workspace\." src/

# Find command registrations
rg -n "vscode\.commands\.register" src/
```

---

## Common Gotchas

### ADB Server Connection

The extension connects to the local ADB server on port 5037:
```typescript
const connector = new AdbServerNodeTcpConnector({
    host: '127.0.0.1',
    port: 5037,
});
```
ADB server must be running before the extension can discover devices.

### Video Buffering

Video data is buffered and sent in batches to avoid overwhelming the webview:
```typescript
// Buffer limit: 2MB to prevent memory issues
private static readonly MAX_VIDEO_BUFFER_SIZE = 2 * 1024 * 1024;

// Batch interval: ~8ms for low latency
this._sendVideoTimeout = setTimeout(() => {
    const combined = Buffer.concat(this._videoBuffer);
    this._view.webview.postMessage({
        type: 'video',
        data: combined.toString('base64'),  // Base64 for efficiency
    });
}, 8);
```
See [views/ScrcpySidebarView.ts:366-398](views/ScrcpySidebarView.ts#L366-L398)

### Visibility Handling

Streaming is paused when sidebar is hidden and resumed when visible:
```typescript
this._view.onDidChangeVisibility(async () => {
    if (this._view.visible) {
        if (this._wasStreamingBeforeHidden) {
            await this._startStreaming();
        }
    } else {
        if (this._scrcpyService?.isActive()) {
            this._wasStreamingBeforeHidden = true;
            this._stopStreaming();
        }
    }
});
```
See [views/ScrcpySidebarView.ts:115-151](views/ScrcpySidebarView.ts#L115-L151)

### Disposable Pattern

Always clean up resources in `dispose()`:
```typescript
public dispose() {
    ScrcpySidebarView.currentView = undefined;
    this._stopStreaming();
    this._deviceInfoService?.dispose();
    this._appManager?.dispose();

    while (this._disposables.length) {
        const x = this._disposables.pop();
        x?.dispose();
    }
}
```

### AbortController for Streams

Use AbortController to cancel pending stream reads:
```typescript
this.streamAbortController = new AbortController();
const abortSignal = this.streamAbortController.signal;

// In stop():
if (this.streamAbortController) {
    this.streamAbortController.abort();
}
```
See [services/ScrcpyService.ts:197-285](services/ScrcpyService.ts#L197-L285)

---

## @yume-chan/adb API Reference

### Key Classes

- `AdbServerClient` - Connects to local ADB server
- `Adb` - Represents connection to a device
- `AdbScrcpyClient` - Scrcpy protocol client
- `ScrcpyControlMessageWriter` - Sends touch/key events

### Key Types

- `AndroidKeyCode` - Android key codes (HOME=3, BACK=4, etc.)
- `AndroidMotionEventAction` - Touch actions (Down, Move, Up)
- `AndroidScreenPowerMode` - Screen power states (Off, Normal)

### Example: Touch Event

```typescript
this.controller.injectTouch({
    action: AndroidMotionEventAction.Down,
    pointerId: BigInt(0),
    pointerX: x,
    pointerY: y,
    videoWidth: videoWidth,
    videoHeight: videoHeight,
    pressure: 1.0,
    actionButton: AndroidMotionEventButton.Primary,
    buttons: AndroidMotionEventButton.Primary,
});
```
See [services/ScrcpyService.ts:341-352](services/ScrcpyService.ts#L341-L352)

---

## Pre-PR Checklist

```bash
npm run typecheck && npm run lint && npm run format:check
```

All checks must pass before creating a PR.
