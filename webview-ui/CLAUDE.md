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

    const processVideoConfig = useCallback((payload: ArrayBuffer | ArrayBufferView) => {
        // Find the SPS and configure the decoder
    }, []);

    const processVideoPacket = useCallback(
        (payload: ArrayBuffer | ArrayBufferView, keyframe: boolean, pts: number) => {
            // Decode one H.264 access unit
        },
        []
    );

    const reset = useCallback(() => {
        // Clean up decoder state
    }, []);

    return { setCanvas, processVideoConfig, processVideoPacket, reset, getVideoSize };
}
```

Example: [src/hooks/useVideoDecoder.ts](src/hooks/useVideoDecoder.ts)

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
            processVideoPacket(message.data, message.k === 1, message.pts);
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
// ✅ DO: Wrap the transferred buffer instead of copying it
// The extension posts an exact-bounds ArrayBuffer, so a view over it costs
// nothing. `new EncodedVideoChunk({data})` copies internally per spec, which
// makes that the one unavoidable copy per frame.
const data = new Uint8Array(payload);

decoder.decode(new EncodedVideoChunk({ type: keyframe ? 'key' : 'delta', timestamp, data }));
```

Example: [src/hooks/useVideoDecoder.ts](src/hooks/useVideoDecoder.ts)

```typescript
// ✅ DO: drive a per-pointermove transform imperatively, not through state
// A pan that goes through setState costs a React render *and* a forced layout
// per move, interleaved with drawImage on the same main thread. `panRef` is the
// live value; React state only catches up on pointer-up, for the HUD.
const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
        panRef.current = clampPan(
            { x: panRef.current.x + deltaX, y: panRef.current.y + deltaY },
            zoomRef.current
        );
        writeTransform(); // content.style.transform = ...
    },
    [clampPan, writeTransform]
);
```

Clamp bounds come from cached `offsetWidth`/`clientWidth` measured once at pan
start - never read layout inside a state updater. The transform lives *only* in
the imperative write, so React must not also set it via `style`.

Example: [src/hooks/useZoom.ts](src/hooks/useZoom.ts)

```typescript
// ✅ DO: invalidate a child's cached geometry through an imperative handle
// A changing `invalidateCacheKey` prop defeats memo() on VideoCanvas and
// re-renders the canvas the decoder is drawing into.
const canvasHandleRef = useRef<VideoCanvasHandle | null>(null);
const handleTransformChange = useCallback(() => {
    canvasHandleRef.current?.invalidateGeometry();
}, []);
```

Example: [src/apps/MirrorApp.tsx](src/apps/MirrorApp.tsx)

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
  - SPS lookup for codec configuration (`findNal`, once per stream)
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

### Video Wire Format

Video arrives as raw `ArrayBuffer`, one message per H.264 access unit. VS Code
transfers an `ArrayBuffer` rather than cloning it, so there is no base64 hop and
no byte-by-byte decode on the main thread:

```typescript
// Extension posts: { type: 'video', k: 0 | 1, pts: number, data: ArrayBuffer }
// Webview wraps it - no copy:
const data = new Uint8Array(payload);
```

`k` is the keyframe flag and `pts` a monotonic microsecond timestamp, both read
straight off the message - the webview never scans NAL units to recover them.
Keyframes arrive with SPS+PPS already prepended, so any keyframe can configure or
recover the decoder.

### Frame Dropping for Backpressure

When decoder queue is too deep, drop non-keyframes. This is the **first** thing
the packet handler does - `keyframe` is a message field, so the decision costs one
field read and no parsing:
```typescript
const MAX_DECODE_QUEUE_SIZE = 3;

if (!keyframe && (decoderRef.current?.decodeQueueSize ?? 0) > MAX_DECODE_QUEUE_SIZE) {
    droppedFramesRef.current++;
    return; // Drop this non-keyframe
}
```

A local drop still paid for a host copy, a `postMessage` and a structured clone, so
sustained saturation is also reported upstream - once per transition, never per
frame:

```typescript
vscode.postMessage({ command: 'video-backpressure', saturated: true });
```

Entry needs real evidence (a queue over 6 on two consecutive frames, **or** ~30
consecutive locally dropped deltas - the case where the queue pins just under the
drop threshold and no depth test would ever fire). While saturated the extension
forwards keyframes only, so recovery is detected by polling `decodeQueueSize`
rather than by arriving frames. See [src/hooks/useVideoDecoder.ts](src/hooks/useVideoDecoder.ts)

### Memo and Prop Identity

`Toolbar`, `VideoCanvas`, `DeviceSelector` and `ZoomHud` are all `memo()`'d, which
means every handler they receive has to be wrapped in `useCallback` - one inline
arrow is enough to make the memo a no-op. Two non-obvious cases:

- `DeviceSelector` refreshes the device list in an effect keyed on `isOpen`. An
  unstable `onRefresh` in the dep array re-fires it and re-posts `get-device-list`,
  so the callback is held in a ref.
- `useVSCodeMessages` registers its `message` listener once and routes through a
  ref. The effect also posts `ready`, which kicks off extension-side init - a dep
  change must never be able to retrigger that.

`unstable_batchedUpdates` is a React-17 shim and a no-op under `createRoot`;
event handlers batch automatically.

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

Output is built to `../media/build/` for the extension to serve. `media/webview.html`
links exactly two files by name - `webview.js` and `webview.css` - so those stay
unhashed; everything else is a hashed chunk under `chunks/`:

```typescript
// vite.config.ts
export default defineConfig({
    base: './',
    build: {
        outDir: '../media/build',
        rollupOptions: {
            output: {
                entryFileNames: 'webview.js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                // Vite names a CSS asset after the chunk that owns it, so the entry's
                // sheet is "index.css" and every other one is named for its app chunk.
                assetFileNames: (asset) =>
                    asset.names?.[0] === 'index.css'
                        ? 'webview.[ext]'
                        : 'chunks/[name]-[hash].[ext]',
            },
        },
    },
});
```

### Code splitting

One webview shows one view, chosen by the extension before the bundle loads, so
`App.tsx` mounts the four apps through `React.lazy` and each becomes its own chunk.
Three rules keep that split real:

- **Import shared components by path, not through `../components`.** The barrel pulls
  `Toolbar`, `VideoCanvas` and the rest into whichever chunk touches it, which is
  exactly what the split is meant to avoid. `import { DeviceSelector } from
  '../components/DeviceSelector'` - the barrel is for the mirror view, which needs
  all of it anyway.
- **`styles/index.css` is core only** (base, buttons, deviceSelector, tooltip). A
  sheet used by one view is imported by that view's app module so it rides that
  chunk; Vite injects the `<link>` before executing the chunk.
- **`base: './'` is load-bearing.** Chunk URLs resolve against the entry's
  `import.meta.url`, which the extension rewrites to a webview-resource URI under
  `media/build/`. An absolute base resolves against the webview origin root and 404s.

`media/webview.html` loads the entry with `type="module"` - required for dynamic
import. That is a cross-origin load (`vscode-webview://` document, `vscode-cdn.net`
resource), which works because VS Code's webview service worker serves resources
with `Access-Control-Allow-Origin: *`. The CSP allows the chunks too: `script-src
{{cspSource}}` covers the whole resource host, not just the files named in the HTML.

---

## H.264 NAL Unit Reference

NAL (Network Abstraction Layer) unit types in H.264:

| Type | Name | Description |
|------|------|-------------|
| 1 | Non-IDR | Regular P/B frame (needs reference frames) |
| 5 | IDR | Keyframe (can be decoded independently) |
| 7 | SPS | Sequence Parameter Set (codec configuration) |
| 8 | PPS | Picture Parameter Set (picture configuration) |

The decoder is configured from the SPS in an Annex-B blob - either the
`video-config` message or the configuration prepended to any keyframe:
```typescript
const sps = findNal(annexB, NAL_SPS);
const codec = parseSPS(sps); // "avc1.640028"
decoder.configure({ codec, optimizeForLatency: true });
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
