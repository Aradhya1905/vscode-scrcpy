import { useRef, useCallback, useEffect, memo } from 'react';
import { useKeyboard } from '../hooks';
import { SCROLL_WHEEL_SCALE, SCROLL_WHEEL_DIVISOR } from '../constants';

interface VideoCanvasProps {
    isConnected: boolean;
    canvasRef: (canvas: HTMLCanvasElement | null) => void;
    getVideoSize: () => { width: number; height: number };
    onTouchEvent: (
        action: 'down' | 'move' | 'up',
        x: number,
        y: number,
        videoWidth: number,
        videoHeight: number
    ) => void;
    onKeyEvent: (action: 'down' | 'up', keyCode: number, metaState: number) => void;
    onLog: (message: string) => void;
    onScrollEvent: (
        x: number,
        y: number,
        deltaX: number,
        deltaY: number,
        videoWidth: number,
        videoHeight: number
    ) => void;
    onPasteText?: (text: string) => void;
    invalidateCacheKey?: number;
    touchEnabled?: boolean;
    /** Ctrl (or Ctrl+Shift) + wheel: 1 = zoom in, -1 = zoom out */
    onZoomWheel?: (direction: 1 | -1, clientX: number, clientY: number) => void;
    /** Middle-mouse drag delta, in viewport pixels */
    onPan?: (deltaX: number, deltaY: number) => void;
    /** Fired when a middle-drag pan starts/ends, so the parent can update the cursor */
    onPanStateChange?: (isPanning: boolean) => void;
}

// Minimum interval between touch move events (ms)
const TOUCH_THROTTLE_MS = 16; // ~60fps max for touch events

export const VideoCanvas = memo(function VideoCanvas({
    isConnected,
    canvasRef,
    getVideoSize,
    onTouchEvent,
    onKeyEvent,
    onLog,
    onScrollEvent,
    onPasteText,
    invalidateCacheKey,
    touchEnabled = true,
    onZoomWheel,
    onPan,
    onPanStateChange,
}: VideoCanvasProps) {
    const internalCanvasRef = useRef<HTMLCanvasElement>(null);
    const isPointerDownRef = useRef(false);
    const lastPointerPosRef = useRef({ x: 0, y: 0 });

    // Middle-mouse drag panning (only relevant while zoomed in)
    const isPanningRef = useRef(false);
    const lastPanPosRef = useRef({ x: 0, y: 0 });

    // Performance optimization: cache bounding rect to avoid layout thrashing
    const cachedRectRef = useRef<DOMRect | null>(null);
    const lastRectUpdateRef = useRef(0);

    // Memoized rendering geometry to avoid recalculating on every touch event
    const renderGeometryRef = useRef<{
        videoWidth: number;
        videoHeight: number;
        canvasWidth: number;
        canvasHeight: number;
        renderedWidth: number;
        renderedHeight: number;
        offsetX: number;
        offsetY: number;
        scaleX: number;
        scaleY: number;
    } | null>(null);

    // RAF-based touch throttling
    const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
    const rafIdRef = useRef<number | null>(null);
    const lastTouchTimeRef = useRef(0);

    // Handle paste request from keyboard (Ctrl+V)
    const handlePasteRequest = useCallback(async () => {
        if (!isConnected || !onPasteText) {
            console.log('[VideoCanvas] handlePasteRequest aborted - not connected or no handler');
            return;
        }

        try {
            const text = await navigator.clipboard.readText();
            if (text && text.length > 0) {
                onPasteText(text);
            } else {
                console.log('[VideoCanvas] No text in clipboard');
            }
        } catch (error) {
            console.error('[VideoCanvas] Failed to read clipboard:', error);
        }
    }, [isConnected, onPasteText]);

    const { handleKeyDown, handleKeyUp, resetModifiers } = useKeyboard({
        isConnected,
        onKeyEvent,
        onLog,
        onPasteRequest: handlePasteRequest,
    });

    // Set canvas ref to parent
    useEffect(() => {
        canvasRef(internalCanvasRef.current);
    }, [canvasRef]);

    // Reset modifiers when disconnected
    useEffect(() => {
        if (!isConnected) {
            resetModifiers();
        }
    }, [isConnected, resetModifiers]);

    // Update cached rect periodically (every 100ms max) to handle resize
    const getCachedRect = useCallback(() => {
        const now = performance.now();
        if (!cachedRectRef.current || now - lastRectUpdateRef.current > 100) {
            cachedRectRef.current = internalCanvasRef.current?.getBoundingClientRect() || null;
            lastRectUpdateRef.current = now;
        }
        return cachedRectRef.current;
    }, []);

    // Invalidate cache on resize
    useEffect(() => {
        const observer = new ResizeObserver(() => {
            cachedRectRef.current = null;
            renderGeometryRef.current = null; // Also invalidate render geometry
        });
        if (internalCanvasRef.current) {
            observer.observe(internalCanvasRef.current);
        }
        return () => observer.disconnect();
    }, []);

    // Invalidate cache when key changes (e.g., device skin toggle)
    useEffect(() => {
        if (invalidateCacheKey !== undefined) {
            cachedRectRef.current = null;
            renderGeometryRef.current = null; // Also invalidate render geometry
            lastRectUpdateRef.current = 0;
            // Force immediate rect update on next interaction
            if (internalCanvasRef.current) {
                // Trigger a resize event to ensure layout is updated
                const canvas = internalCanvasRef.current;
                const rect = canvas.getBoundingClientRect();
                cachedRectRef.current = rect;
                lastRectUpdateRef.current = performance.now();
            }
        }
    }, [invalidateCacheKey]);

    // Update cached render geometry when video or canvas size changes
    const updateRenderGeometry = useCallback(() => {
        const videoSize = getVideoSize();
        const canvasRect = getCachedRect();

        if (!canvasRect || videoSize.width === 0 || videoSize.height === 0) {
            renderGeometryRef.current = null;
            return;
        }

        // Check if we need to recalculate
        const cached = renderGeometryRef.current;
        if (
            cached &&
            cached.videoWidth === videoSize.width &&
            cached.videoHeight === videoSize.height &&
            cached.canvasWidth === canvasRect.width &&
            cached.canvasHeight === canvasRect.height
        ) {
            return; // No change, use cached values
        }

        // Calculate the actual rendered video size (accounting for object-fit: contain)
        const videoAspect = videoSize.width / videoSize.height;
        const canvasAspect = canvasRect.width / canvasRect.height;

        let renderedWidth: number;
        let renderedHeight: number;
        let offsetX = 0;
        let offsetY = 0;

        if (videoAspect > canvasAspect) {
            // Video is wider - fit to width
            renderedWidth = canvasRect.width;
            renderedHeight = canvasRect.width / videoAspect;
            offsetY = (canvasRect.height - renderedHeight) / 2;
        } else {
            // Video is taller - fit to height
            renderedHeight = canvasRect.height;
            renderedWidth = canvasRect.height * videoAspect;
            offsetX = (canvasRect.width - renderedWidth) / 2;
        }

        renderGeometryRef.current = {
            videoWidth: videoSize.width,
            videoHeight: videoSize.height,
            canvasWidth: canvasRect.width,
            canvasHeight: canvasRect.height,
            renderedWidth,
            renderedHeight,
            offsetX,
            offsetY,
            scaleX: videoSize.width / renderedWidth,
            scaleY: videoSize.height / renderedHeight,
        };
    }, [getVideoSize, getCachedRect]);

    const getDeviceCoordinates = useCallback(
        (canvasX: number, canvasY: number) => {
            // Ensure geometry is up to date
            updateRenderGeometry();

            const geometry = renderGeometryRef.current;
            if (!geometry) {
                return { x: 0, y: 0 };
            }

            // Use cached geometry values for coordinate calculation
            const {
                renderedWidth,
                renderedHeight,
                offsetX,
                offsetY,
                scaleX,
                scaleY,
                videoWidth,
                videoHeight,
            } = geometry;

            // Adjust coordinates to account for letterboxing/pillarboxing
            const adjustedX = canvasX - offsetX;
            const adjustedY = canvasY - offsetY;

            // Clamp to rendered video area
            const clampedX = Math.max(0, Math.min(adjustedX, renderedWidth));
            const clampedY = Math.max(0, Math.min(adjustedY, renderedHeight));

            // Map to device coordinates using cached scale factors
            const deviceX = Math.round(clampedX * scaleX);
            const deviceY = Math.round(clampedY * scaleY);

            return {
                x: Math.max(0, Math.min(deviceX, videoWidth - 1)),
                y: Math.max(0, Math.min(deviceY, videoHeight - 1)),
            };
        },
        [updateRenderGeometry]
    );

    const sendTouchEvent = useCallback(
        (action: 'down' | 'move' | 'up', x: number, y: number) => {
            const videoSize = getVideoSize();
            if (!isConnected || videoSize.width === 0 || videoSize.height === 0) {
                return;
            }
            onTouchEvent(action, x, y, videoSize.width, videoSize.height);
        },
        [isConnected, getVideoSize, onTouchEvent]
    );

    // Flush any pending move event
    const flushPendingMove = useCallback(() => {
        if (pendingMoveRef.current && isPointerDownRef.current) {
            const { x, y } = pendingMoveRef.current;
            sendTouchEvent('move', x, y);
            lastPointerPosRef.current = { x, y };
            lastTouchTimeRef.current = performance.now();
        }
        pendingMoveRef.current = null;
        rafIdRef.current = null;
    }, [sendTouchEvent]);

    // Cleanup RAF on unmount
    useEffect(() => {
        return () => {
            if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
            }
        };
    }, []);

    // End an in-progress pan drag. Returns true if a pan was actually active.
    const endPan = useCallback(
        (pointerId?: number) => {
            if (!isPanningRef.current) return false;

            isPanningRef.current = false;
            if (pointerId !== undefined) {
                try {
                    internalCanvasRef.current?.releasePointerCapture(pointerId);
                } catch {
                    // Capture may already have been released by the browser
                }
            }
            onPanStateChange?.(false);
            return true;
        },
        [onPanStateChange]
    );

    const handlePointerDown = useCallback(
        (event: React.PointerEvent) => {
            if (!isConnected) return;

            // Middle button pans the zoomed view instead of touching the device
            if (event.button === 1) {
                if (!onPan) return;
                event.preventDefault();
                isPanningRef.current = true;
                lastPanPosRef.current = { x: event.clientX, y: event.clientY };
                internalCanvasRef.current?.setPointerCapture(event.pointerId);
                onPanStateChange?.(true);
                return;
            }

            // Only the primary button generates device touch events
            if (event.button !== 0 || !touchEnabled) return;

            event.preventDefault();
            isPointerDownRef.current = true;

            // Focus canvas for keyboard events
            internalCanvasRef.current?.focus();

            // Force rect update on pointer down for accuracy
            cachedRectRef.current = internalCanvasRef.current?.getBoundingClientRect() || null;
            lastRectUpdateRef.current = performance.now();

            const canvasRect = cachedRectRef.current;
            if (!canvasRect) return;

            const canvasX = event.clientX - canvasRect.left;
            const canvasY = event.clientY - canvasRect.top;

            const deviceCoords = getDeviceCoordinates(canvasX, canvasY);
            lastPointerPosRef.current = deviceCoords;
            lastTouchTimeRef.current = performance.now();

            sendTouchEvent('down', deviceCoords.x, deviceCoords.y);
        },
        [isConnected, touchEnabled, getDeviceCoordinates, sendTouchEvent, onPan, onPanStateChange]
    );

    const handlePointerMove = useCallback(
        (event: React.PointerEvent) => {
            // Pan drag takes priority and is independent of the touch pipeline
            if (isPanningRef.current) {
                event.preventDefault();
                const deltaX = event.clientX - lastPanPosRef.current.x;
                const deltaY = event.clientY - lastPanPosRef.current.y;
                lastPanPosRef.current = { x: event.clientX, y: event.clientY };
                onPan?.(deltaX, deltaY);
                return;
            }

            if (!isConnected || !touchEnabled || !isPointerDownRef.current) return;

            event.preventDefault();

            const canvasRect = getCachedRect();
            if (!canvasRect) return;

            const canvasX = event.clientX - canvasRect.left;
            const canvasY = event.clientY - canvasRect.top;

            const deviceCoords = getDeviceCoordinates(canvasX, canvasY);

            // Minimum movement threshold (device pixels)
            const dx = Math.abs(deviceCoords.x - lastPointerPosRef.current.x);
            const dy = Math.abs(deviceCoords.y - lastPointerPosRef.current.y);

            if (dx < 3 && dy < 3) {
                return; // Ignore micro-movements
            }

            // RAF-based throttling: coalesce rapid moves into single RAF callback
            const now = performance.now();
            const elapsed = now - lastTouchTimeRef.current;

            if (elapsed >= TOUCH_THROTTLE_MS) {
                // Enough time has passed, send immediately
                sendTouchEvent('move', deviceCoords.x, deviceCoords.y);
                lastPointerPosRef.current = deviceCoords;
                lastTouchTimeRef.current = now;
                pendingMoveRef.current = null;
            } else {
                // Queue move for next RAF
                pendingMoveRef.current = deviceCoords;
                if (!rafIdRef.current) {
                    rafIdRef.current = requestAnimationFrame(flushPendingMove);
                }
            }
        },
        [
            isConnected,
            touchEnabled,
            getDeviceCoordinates,
            getCachedRect,
            sendTouchEvent,
            flushPendingMove,
            onPan,
        ]
    );

    const handlePointerUp = useCallback(
        (event: React.PointerEvent) => {
            if (endPan(event.pointerId)) return;

            if (!isConnected || !touchEnabled || !isPointerDownRef.current) return;

            event.preventDefault();
            isPointerDownRef.current = false;

            // Cancel any pending move and send final position
            if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }

            // Use pending position if available, otherwise use last known
            const finalPos = pendingMoveRef.current || lastPointerPosRef.current;
            pendingMoveRef.current = null;

            sendTouchEvent('up', finalPos.x, finalPos.y);
        },
        [isConnected, touchEnabled, sendTouchEvent, endPan]
    );

    const handlePointerLeave = useCallback(() => {
        if (endPan()) return;

        if (!isConnected || !touchEnabled || !isPointerDownRef.current) return;

        isPointerDownRef.current = false;

        // Cancel any pending move
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }

        const finalPos = pendingMoveRef.current || lastPointerPosRef.current;
        pendingMoveRef.current = null;

        sendTouchEvent('up', finalPos.x, finalPos.y);
    }, [isConnected, touchEnabled, sendTouchEvent, endPan]);

    const handleWheel = useCallback(
        (event: React.WheelEvent) => {
            if (!isConnected) return;

            event.preventDefault();

            // Ctrl (or Ctrl+Shift) + wheel zooms the view instead of scrolling the
            // device. preventDefault above also suppresses the host's page zoom.
            if (event.ctrlKey && onZoomWheel) {
                if (event.deltaY !== 0) {
                    onZoomWheel(event.deltaY < 0 ? 1 : -1, event.clientX, event.clientY);
                }
                return;
            }

            const canvasRect = getCachedRect();
            if (!canvasRect) return;

            const canvasX = event.clientX - canvasRect.left;
            const canvasY = event.clientY - canvasRect.top;
            const deviceCoords = getDeviceCoordinates(canvasX, canvasY);
            const videoSize = getVideoSize();

            if (videoSize.width === 0 || videoSize.height === 0) {
                return;
            }

            // Apply scroll sensitivity scaling
            // Allow values below 1 for very slow scrolling
            const scale = SCROLL_WHEEL_SCALE / SCROLL_WHEEL_DIVISOR;
            const scaledDeltaX = event.deltaX * scale;
            const scaledDeltaY = event.deltaY * scale;

            onScrollEvent(
                deviceCoords.x,
                deviceCoords.y,
                scaledDeltaX,
                scaledDeltaY,
                videoSize.width,
                videoSize.height
            );
        },
        [isConnected, getCachedRect, getDeviceCoordinates, getVideoSize, onScrollEvent, onZoomWheel]
    );

    // Attach wheel event listener with {passive: false} to allow preventDefault
    useEffect(() => {
        const canvas = internalCanvasRef.current;
        if (!canvas) return;

        const wheelHandler = (event: WheelEvent) => {
            handleWheel(event as any);
        };

        canvas.addEventListener('wheel', wheelHandler, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', wheelHandler);
        };
    }, [handleWheel]);

    // Suppress the browser's middle-click autoscroll so it can't fight the pan drag
    const handleAuxClick = useCallback((event: React.MouseEvent) => {
        if (event.button === 1) {
            event.preventDefault();
        }
    }, []);

    // Handle paste events (Ctrl+V)
    const handlePaste = useCallback(
        (event: React.ClipboardEvent) => {
            if (!isConnected || !onPasteText) {
                console.log('[VideoCanvas] handlePaste aborted - not connected or no handler');
                return;
            }

            event.preventDefault();

            // Get text from clipboard
            const text = event.clipboardData?.getData('text/plain');
            if (text && text.length > 0) {
                onPasteText(text);
            } else {
                console.log('[VideoCanvas] No text to paste');
            }
        },
        [isConnected, onPasteText]
    );

    return (
        <canvas
            ref={internalCanvasRef}
            className="video-canvas"
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onAuxClick={handleAuxClick}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onPaste={handlePaste}
        />
    );
});
