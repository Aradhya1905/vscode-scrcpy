import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Browser-style zoom ladder. Matches the steps Chrome/Edge use so the
 * displayed percentages feel familiar (100% -> 110% -> 125% -> 133% ...).
 */
export const ZOOM_STEPS = [
    0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.33, 1.5, 1.75, 2, 2.5, 3, 4,
] as const;

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const DEFAULT_ZOOM = 1;

/** How long the zoom HUD stays on screen after the last change (ms) */
const HUD_TIMEOUT_MS = 2500;

/** Clamp an arbitrary (possibly persisted/corrupted) value into the valid range */
export function clampZoom(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_ZOOM;
    }
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** Nearest ladder step in the given direction (+1 = zoom in, -1 = zoom out) */
function nextStep(current: number, direction: 1 | -1): number {
    if (direction === 1) {
        const step = ZOOM_STEPS.find((value) => value > current + 0.001);
        return step ?? MAX_ZOOM;
    }
    const reversed = [...ZOOM_STEPS].reverse();
    const step = reversed.find((value) => value < current - 0.001);
    return step ?? MIN_ZOOM;
}

interface PanOffset {
    x: number;
    y: number;
}

/**
 * Layout sizes the pan clamp needs. These are untransformed layout boxes, so
 * they change only on a real resize - never as a result of zooming or panning.
 * Cached so that a pointermove never reads layout.
 */
interface PanBounds {
    contentWidth: number;
    contentHeight: number;
    viewportWidth: number;
    viewportHeight: number;
}

interface UseZoomOptions {
    /** Zoom level restored from persisted settings */
    initialZoom?: number;
    /** True once persisted settings have finished loading */
    isSettingsLoaded?: boolean;
    /** Called whenever the user changes the zoom level, for persistence */
    onZoomChange?: (zoom: number) => void;
    /**
     * Called after the transform has been written to the DOM. Consumers that
     * cache the on-screen geometry (the canvas rect cache) must invalidate here,
     * because a CSS transform fires no resize observer.
     */
    onTransformChange?: () => void;
}

export function useZoom({
    initialZoom,
    isSettingsLoaded,
    onZoomChange,
    onTransformChange,
}: UseZoomOptions = {}) {
    // React state mirrors the transform for anything that renders from it (the
    // HUD). It is deliberately *not* the source of truth during a pan drag - see
    // panBy/setPanActive below.
    const [zoom, setZoom] = useState(DEFAULT_ZOOM);
    const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
    const [isHudVisible, setIsHudVisible] = useState(false);

    // The clipping viewport (.video-container) and the transformed wrapper (.zoom-content)
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const contentNodeRef = useRef<HTMLDivElement | null>(null);

    // Live transform. Authoritative; the state above trails it.
    const zoomRef = useRef(DEFAULT_ZOOM);
    const panRef = useRef<PanOffset>({ x: 0, y: 0 });
    const boundsRef = useRef<PanBounds | null>(null);

    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const hudTimerRef = useRef<number | null>(null);
    const hasHydratedRef = useRef(false);

    // Kept in a ref so writeTransform - and therefore the content ref callback -
    // stay referentially stable regardless of the caller's callback identity.
    const onTransformChangeRef = useRef(onTransformChange);
    onTransformChangeRef.current = onTransformChange;

    // ===== HUD visibility =====

    const clearHudTimer = useCallback(() => {
        if (hudTimerRef.current !== null) {
            window.clearTimeout(hudTimerRef.current);
            hudTimerRef.current = null;
        }
    }, []);

    /** Show the HUD and start the auto-hide countdown */
    const showHud = useCallback(() => {
        clearHudTimer();
        setIsHudVisible(true);
        hudTimerRef.current = window.setTimeout(() => {
            setIsHudVisible(false);
            hudTimerRef.current = null;
        }, HUD_TIMEOUT_MS);
    }, [clearHudTimer]);

    /** Keep the HUD on screen indefinitely (used while hovered/focused) */
    const holdHud = useCallback(() => {
        clearHudTimer();
        setIsHudVisible(true);
    }, [clearHudTimer]);

    useEffect(() => clearHudTimer, [clearHudTimer]);

    // ===== Transform =====

    /** Write the live transform straight to the DOM - no React render involved */
    const writeTransform = useCallback(() => {
        const content = contentNodeRef.current;
        if (!content) {
            return;
        }
        const { x, y } = panRef.current;
        content.style.transform = `translate(${x}px, ${y}px) scale(${zoomRef.current})`;
        onTransformChangeRef.current?.();
    }, []);

    // ===== Pan clamping =====

    /** Read the layout boxes once and cache them */
    const measureBounds = useCallback((): PanBounds | null => {
        const viewport = viewportRef.current;
        const content = contentNodeRef.current;
        if (!viewport || !content) {
            boundsRef.current = null;
            return null;
        }

        // offsetWidth/Height are layout sizes, unaffected by the CSS transform
        const bounds: PanBounds = {
            contentWidth: content.offsetWidth,
            contentHeight: content.offsetHeight,
            viewportWidth: viewport.clientWidth,
            viewportHeight: viewport.clientHeight,
        };
        boundsRef.current = bounds;
        return bounds;
    }, []);

    /**
     * Limit the pan offset so the scaled content can never be dragged fully out
     * of view. The maximum travel on each axis is half of the overflow.
     */
    const clampPan = useCallback(
        (offset: PanOffset, level: number): PanOffset => {
            const bounds = boundsRef.current ?? measureBounds();
            if (!bounds) {
                return offset;
            }

            const maxX = Math.max(0, (bounds.contentWidth * level - bounds.viewportWidth) / 2);
            const maxY = Math.max(0, (bounds.contentHeight * level - bounds.viewportHeight) / 2);

            return {
                x: Math.min(maxX, Math.max(-maxX, offset.x)),
                y: Math.min(maxY, Math.max(-maxY, offset.y)),
            };
        },
        [measureBounds]
    );

    /** Attach/detach the transformed wrapper, keeping the observer and transform in sync */
    const contentRef = useCallback(
        (node: HTMLDivElement | null) => {
            const previous = contentNodeRef.current;
            if (previous) {
                resizeObserverRef.current?.unobserve(previous);
            }

            contentNodeRef.current = node;
            boundsRef.current = null;

            if (node) {
                resizeObserverRef.current?.observe(node);
                // The node mounts without a transform, so re-apply the live one
                writeTransform();
            }
        },
        [writeTransform]
    );

    // ===== Zoom actions =====

    const applyZoom = useCallback(
        (nextZoom: number, nextPan: PanOffset) => {
            // A deliberate user change always wins over a late settings hydration
            hasHydratedRef.current = true;
            zoomRef.current = nextZoom;
            panRef.current = clampPan(nextPan, nextZoom);
            writeTransform();

            setZoom(nextZoom);
            setPan(panRef.current);
            showHud();
            onZoomChange?.(nextZoom);
        },
        [clampPan, writeTransform, showHud, onZoomChange]
    );

    /**
     * Zoom one ladder step while keeping the point under the cursor anchored.
     *
     * With `translate(p) scale(z)` and `transform-origin: center`, a content point
     * maps to `center + p + z*x`. Solving for the pan that keeps the cursor point
     * `c` (relative to the viewport centre) fixed gives:
     *     p' = c - (c - p) * (z' / z)
     */
    const zoomAtPoint = useCallback(
        (direction: 1 | -1, clientX: number, clientY: number) => {
            const viewport = viewportRef.current;
            const currentZoom = zoomRef.current;
            const currentPan = panRef.current;
            const nextZoom = nextStep(currentZoom, direction);

            if (nextZoom === currentZoom) {
                showHud(); // Already at a limit - still surface the HUD as feedback
                return;
            }

            if (!viewport) {
                applyZoom(nextZoom, currentPan);
                return;
            }

            const rect = viewport.getBoundingClientRect();
            const cursorX = clientX - (rect.left + rect.width / 2);
            const cursorY = clientY - (rect.top + rect.height / 2);
            const ratio = nextZoom / currentZoom;

            applyZoom(nextZoom, {
                x: cursorX - (cursorX - currentPan.x) * ratio,
                y: cursorY - (cursorY - currentPan.y) * ratio,
            });
        },
        [applyZoom, showHud]
    );

    /** Zoom one step from the centre of the viewport (HUD buttons) */
    const zoomByStep = useCallback(
        (direction: 1 | -1) => {
            const currentZoom = zoomRef.current;
            const currentPan = panRef.current;
            const nextZoom = nextStep(currentZoom, direction);

            if (nextZoom === currentZoom) {
                showHud();
                return;
            }

            const ratio = nextZoom / currentZoom;
            applyZoom(nextZoom, { x: currentPan.x * ratio, y: currentPan.y * ratio });
        },
        [applyZoom, showHud]
    );

    const zoomIn = useCallback(() => zoomByStep(1), [zoomByStep]);
    const zoomOut = useCallback(() => zoomByStep(-1), [zoomByStep]);

    const resetZoom = useCallback(() => {
        applyZoom(DEFAULT_ZOOM, { x: 0, y: 0 });
    }, [applyZoom]);

    // ===== Panning =====

    /**
     * Move the view by a mouse-drag delta. Runs per pointermove, so it must not
     * render React or read layout: it mutates the live pan and writes the
     * transform directly. React state catches up once, on pointer-up.
     */
    const panBy = useCallback(
        (deltaX: number, deltaY: number) => {
            const current = panRef.current;
            const next = clampPan(
                { x: current.x + deltaX, y: current.y + deltaY },
                zoomRef.current
            );

            if (next.x === current.x && next.y === current.y) {
                return; // Already against the clamp on both axes
            }

            panRef.current = next;
            writeTransform();
        },
        [clampPan, writeTransform]
    );

    /**
     * Marks the start/end of a pan drag. Measures the clamp bounds up front so
     * every move in the drag is pure arithmetic, and commits the result to React
     * state at the end so renderers (the HUD) see the final offset.
     */
    const setPanActive = useCallback(
        (active: boolean) => {
            if (active) {
                measureBounds();
                return;
            }
            setPan((previous) => {
                const next = panRef.current;
                return previous.x === next.x && previous.y === next.y ? previous : next;
            });
        },
        [measureBounds]
    );

    // Re-clamp when the viewport or content resizes so the content cannot get
    // stranded off-screen. This is the only place the cached bounds go stale.
    useEffect(() => {
        const observer = new ResizeObserver(() => {
            measureBounds();
            const next = clampPan(panRef.current, zoomRef.current);
            if (next.x === panRef.current.x && next.y === panRef.current.y) {
                return;
            }
            panRef.current = next;
            writeTransform();
            setPan(next);
        });

        resizeObserverRef.current = observer;
        if (viewportRef.current) {
            observer.observe(viewportRef.current);
        }
        if (contentNodeRef.current) {
            observer.observe(contentNodeRef.current);
        }

        return () => {
            observer.disconnect();
            resizeObserverRef.current = null;
        };
    }, [clampPan, measureBounds, writeTransform]);

    // Restore the persisted zoom level once, after settings finish loading
    useEffect(() => {
        if (!isSettingsLoaded || hasHydratedRef.current) return;
        hasHydratedRef.current = true;
        if (typeof initialZoom === 'number') {
            const restored = clampZoom(initialZoom);
            zoomRef.current = restored;
            panRef.current = clampPan(panRef.current, restored);
            writeTransform();
            setZoom(restored);
            setPan(panRef.current);
        }
    }, [isSettingsLoaded, initialZoom, clampPan, writeTransform]);

    return {
        zoom,
        panX: pan.x,
        panY: pan.y,
        isHudVisible,
        viewportRef,
        contentRef,
        zoomIn,
        zoomOut,
        resetZoom,
        zoomAtPoint,
        panBy,
        setPanActive,
        showHud,
        holdHud,
    };
}
