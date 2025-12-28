# VS Code Scrcpy - Webview UI

**Technology**: React 18, TypeScript, Vite 6, WebCodecs API
**Entry Point**: [src/main.tsx](src/main.tsx)
**Parent Context**: This extends [../CLAUDE.md](../CLAUDE.md)

---

## Development Commands

### From This Directory

```bash
# Start Vite dev server (hot reload)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

### From Root Directory

```bash
# Build webview
npm run compile:webview

# Watch webview (hot reload)
npm run watch:webview
```

---

## Architecture

### Directory Structure

```
src/
├── main.tsx                 # React entry point
├── App.tsx                  # Root component (routing by viewMode)
├── vscode.ts                # VS Code webview API bridge
├── constants.ts             # App-wide constants
├── apps/                    # Full-page applications
│   ├── MirrorApp.tsx        # Screen mirroring view
│   ├── FileManagerApp.tsx   # File browser view
│   ├── LogcatApp.tsx        # Logcat viewer
│   └── ShellLogsApp.tsx     # Shell output viewer
├── components/              # Reusable UI components
│   ├── index.ts             # Component exports
│   ├── VideoCanvas.tsx      # WebGL video rendering (430 lines)
│   ├── Toolbar.tsx          # Control buttons
│   ├── DeviceSelector.tsx   # Device picker dropdown
│   ├── SettingsPanel.tsx    # Quality/FPS settings
│   ├── AppLauncher.tsx      # App list/launcher
│   ├── DebugPanel.tsx       # Debug info overlay
│   ├── DeviceStatus.tsx     # Connection status
│   ├── MorePanel.tsx        # Additional options
│   ├── Placeholder.tsx      # Empty state placeholder
│   ├── RecentApps.tsx       # Recent apps list
│   ├── Tooltip.tsx          # Hover tooltips
│   ├── DeviceFrames/        # Phone skin overlays
│   │   ├── PhoneFrame.tsx
│   │   ├── SamsungS20Frame.tsx
│   │   └── SamsungNote20UltraFrame.tsx
│   └── logs/                # Log display components
│       ├── LogsPanel.tsx
│       ├── LogEntryRow.tsx
│       ├── EnhancedLogsPanel.tsx
│       └── EnhancedLogEntryRow.tsx
├── hooks/                   # Custom React hooks
│   ├── index.ts             # Hook exports
│   ├── useVideoDecoder.ts   # H.264 WebCodecs decoding (350 lines)
│   ├── useVSCodeMessages.ts # Extension messaging
│   ├── useKeyboard.ts       # Keyboard event mapping
│   └── useSettingsStorage.ts # Persistent settings
├── styles/                  # CSS stylesheets (15 files)
│   ├── index.css            # Main stylesheet imports
│   ├── base.css             # Base styles
│   ├── buttons.css          # Button styles
│   └── ...                  # Component-specific styles
├── types/                   # TypeScript type definitions
│   ├── index.ts             # Type exports
│   └── index.d.ts           # Declaration file
└── utils/                   # Utility functions
    └── colorUtils.ts        # Color manipulation
```

---

## Code Organization Patterns

### Component Pattern

Use functional components with `memo()` for optimization.

```typescript
// ✅ DO: Memoized functional component with typed props
interface VideoCanvasProps {
    isConnected: boolean;
    canvasRef: (canvas: HTMLCanvasElement | null) => void;
    onTouchEvent: (action: 'down' | 'move' | 'up', x: number, y: number, ...) => void;
    onKeyEvent: (action: 'down' | 'up', keyCode: number, metaState: number) => void;
}

export const VideoCanvas = memo(function VideoCanvas({
    isConnected,
    canvasRef,
    onTouchEvent,
    onKeyEvent,
}: VideoCanvasProps) {
    // Implementation
    return <canvas ref={internalCanvasRef} className="video-canvas" />;
});
```

Example: [src/components/VideoCanvas.tsx:33-43](src/components/VideoCanvas.tsx#L33-L43)

```typescript
// ❌ DON'T: Class components
class VideoCanvas extends React.Component<Props> {
    // Avoid class components in this codebase
}

// ❌ DON'T: Inline component definitions
const App = () => {
    // Missing memo for component with callback props
    const Child = ({ onClick }) => <button onClick={onClick} />;
    return <Child onClick={() => {}} />;
};
```

### Hook Pattern

Custom hooks encapsulate stateful logic.

```typescript
// ✅ DO: Custom hook with clear return type
interface UseVideoDecoderOptions {
    onLog: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

export function useVideoDecoder({ onLog }: UseVideoDecoderOptions) {
    const decoderRef = useRef<VideoDecoder | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const setCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
        canvasRef.current = canvas;
    }, []);

    const processVideoPacket = useCallback((data: string) => {
        // Base64 decode and process H.264 NAL units
    }, []);

    const reset = useCallback(() => {
        // Clean up decoder state
    }, []);

    return { setCanvas, processVideoPacket, reset, getVideoSize };
}
```

Example: [src/hooks/useVideoDecoder.ts:88-351](src/hooks/useVideoDecoder.ts#L88-L351)

### VS Code Message Pattern

Communication with the extension via `postMessage`.

```typescript
// ✅ DO: Type-safe message sending
const vscode = acquireVsCodeApi();

// Send command to extension
vscode.postMessage({ command: 'start' });
vscode.postMessage({ command: 'touch', action: 'down', x: 100, y: 200, ... });

// Listen for messages from extension
window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
        case 'video':
            processVideoPacket(message.data);
            break;
        case 'connected':
            setIsConnected(true);
            break;
        case 'device-list':
            setDevices(message.devices);
            break;
    }
});
```

Example: [src/vscode.ts](src/vscode.ts)

### Performance Optimization Patterns

```typescript
// ✅ DO: Cache expensive calculations
const cachedRectRef = useRef<DOMRect | null>(null);
const lastRectUpdateRef = useRef(0);

const getCachedRect = useCallback(() => {
    const now = performance.now();
    if (!cachedRectRef.current || now - lastRectUpdateRef.current > 100) {
        cachedRectRef.current = canvas?.getBoundingClientRect() || null;
        lastRectUpdateRef.current = now;
    }
    return cachedRectRef.current;
}, []);
```

Example: [src/components/VideoCanvas.tsx:90-97](src/components/VideoCanvas.tsx#L90-L97)

```typescript
// ✅ DO: Throttle high-frequency events
const TOUCH_THROTTLE_MS = 16; // ~60fps max

const handlePointerMove = useCallback((event: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastTouchTimeRef.current < TOUCH_THROTTLE_MS) {
        // Queue for next RAF instead of sending immediately
        pendingMoveRef.current = deviceCoords;
        if (!rafIdRef.current) {
            rafIdRef.current = requestAnimationFrame(flushPendingMove);
        }
        return;
    }
    sendTouchEvent('move', x, y);
    lastTouchTimeRef.current = now;
}, []);
```

Example: [src/components/VideoCanvas.tsx:279-327](src/components/VideoCanvas.tsx#L279-L327)

```typescript
// ✅ DO: Reuse buffers to reduce GC pressure
const decodeBufferRef = useRef<Uint8Array | null>(null);

const processVideoPacket = useCallback((data: string) => {
    const len = binaryString.length;
    if (decodeBufferRef.current && decodeBufferRef.current.length >= len) {
        // Reuse existing buffer
        uint8Data = decodeBufferRef.current.subarray(0, len);
    } else {
        // Allocate with headroom for future frames
        decodeBufferRef.current = new Uint8Array(Math.max(len * 2, 256 * 1024));
    }
}, []);
```

Example: [src/hooks/useVideoDecoder.ts:196-203](src/hooks/useVideoDecoder.ts#L196-L203)

---

## Key Files (Understand These First)

### Entry Point

- **[main.tsx](src/main.tsx)** - React DOM render, determines which app to show
- **[App.tsx](src/App.tsx)** - Root component, routes by `viewMode`

### Core Components

- **[components/VideoCanvas.tsx](src/components/VideoCanvas.tsx)** - Video rendering + input
  - WebGL canvas rendering
  - Pointer events → touch events
  - Keyboard events → key codes
  - Mouse wheel → scroll events

### Core Hooks

- **[hooks/useVideoDecoder.ts](src/hooks/useVideoDecoder.ts)** - H.264 decoding
  - WebCodecs VideoDecoder API
  - NAL unit parsing (SPS, PPS, IDR, non-IDR)
  - Frame timing and backpressure handling

- **[hooks/useVSCodeMessages.ts](src/hooks/useVSCodeMessages.ts)** - Extension messaging
  - Message event listener setup
  - Type-safe message handling

### Styling

- **[styles/index.css](src/styles/index.css)** - Imports all stylesheets
- **[styles/base.css](src/styles/base.css)** - Reset and base styles
- **[styles/videoContainer.css](src/styles/videoContainer.css)** - Video canvas styles

---

## Quick Search Commands

### Find Components

```bash
# Find component definitions
rg -n "export (const|function) \w+ = (memo\()?function" src/components/

# Find component usage
rg -n "<(VideoCanvas|Toolbar|DeviceSelector)" src/

# Find props interfaces
rg -n "interface \w+Props" src/components/
```

### Find Hooks

```bash
# Find custom hook definitions
rg -n "^export function use[A-Z]" src/hooks/

# Find hook usage
rg -n "use(VideoDecoder|VSCodeMessages|Keyboard|SettingsStorage)" src/
```

### Find Message Types

```bash
# Find outgoing commands (webview → extension)
rg -n "postMessage\(\{ command:" src/

# Find incoming message types (extension → webview)
rg -n "case '[a-z-]+'" src/
```

### Find Styles

```bash
# Find className usage
rg -n 'className="' src/components/

# Find CSS class definitions
rg -n "^\." src/styles/
```

---

## Common Gotchas

### ViewMode Routing

The app renders different views based on `viewMode` data attribute:
```typescript
// App.tsx
const viewMode = document.body.dataset.viewMode || 'sidebar';

switch (viewMode) {
    case 'sidebar':
        return <MirrorApp />;
    case 'fileManager':
        return <FileManagerApp />;
    case 'shellLogs':
        return <ShellLogsApp />;
    case 'logcat':
        return <LogcatApp />;
}
```

### WebCodecs Browser Support

WebCodecs API may not be available in all contexts:
```typescript
if (typeof VideoDecoder === 'undefined') {
    onLog('WebCodecs VideoDecoder not supported', 'error');
    return null;
}
```

### Canvas Context Options

Use specific context options for low-latency rendering:
```typescript
const ctx = canvas.getContext('2d', {
    alpha: false,           // No transparency needed
    desynchronized: true,   // Allow async drawing for lower latency
});
```

### Video Coordinate Mapping

Touch coordinates must map from canvas space to device screen space:
```typescript
// Account for letterboxing/pillarboxing when video aspect ≠ canvas aspect
const videoAspect = videoSize.width / videoSize.height;
const canvasAspect = canvasRect.width / canvasRect.height;

if (videoAspect > canvasAspect) {
    // Video is wider - fit to width, letterbox top/bottom
    renderedWidth = canvasRect.width;
    renderedHeight = canvasRect.width / videoAspect;
    offsetY = (canvasRect.height - renderedHeight) / 2;
} else {
    // Video is taller - fit to height, pillarbox left/right
    renderedHeight = canvasRect.height;
    renderedWidth = canvasRect.height * videoAspect;
    offsetX = (canvasRect.width - renderedWidth) / 2;
}
```
See [src/components/VideoCanvas.tsx:150-183](src/components/VideoCanvas.tsx#L150-L183)

### Base64 Decoding Performance

Video data is sent as base64 for efficiency (faster than JSON arrays):
```typescript
// Extension sends: message.data = buffer.toString('base64')
// Webview receives and decodes:
const binaryString = atob(data);
```

### Frame Dropping for Backpressure

When decoder queue is too deep, drop non-keyframes:
```typescript
const MAX_DECODE_QUEUE_SIZE = 3;

if (decoderRef.current.decodeQueueSize > MAX_DECODE_QUEUE_SIZE && !hasKeyframe) {
    droppedFramesRef.current++;
    return; // Drop this non-keyframe
}
```
See [src/hooks/useVideoDecoder.ts:254-270](src/hooks/useVideoDecoder.ts#L254-L270)

### Cleanup on Unmount

Always clean up RAF handles and event listeners:
```typescript
useEffect(() => {
    return () => {
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
        }
    };
}, []);
```

---

## Vite Build Configuration

Output is built to `../media/build/` for extension to serve:

```typescript
// vite.config.ts
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: '../media/build',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                entryFileNames: 'webview.js',
                assetFileNames: 'webview.[ext]',
            },
        },
    },
});
```

The extension serves these files with proper CSP headers.

---

## H.264 NAL Unit Reference

NAL (Network Abstraction Layer) unit types in H.264:

| Type | Name | Description |
|------|------|-------------|
| 1 | Non-IDR | Regular P/B frame (needs reference frames) |
| 5 | IDR | Keyframe (can be decoded independently) |
| 7 | SPS | Sequence Parameter Set (codec configuration) |
| 8 | PPS | Picture Parameter Set (picture configuration) |

The decoder is configured when SPS+PPS are received:
```typescript
if (spsNalRef.current && ppsNalRef.current && !decoderConfiguredRef.current) {
    const codec = parseSPS(spsNalRef.current); // "avc1.640028"
    decoder.configure({ codec, optimizeForLatency: true });
}
```

---

## Pre-PR Checklist

From webview-ui directory:
```bash
npm run build  # Builds successfully
```

From root directory:
```bash
npm run typecheck && npm run lint && npm run format:check
```

All checks must pass before creating a PR.
