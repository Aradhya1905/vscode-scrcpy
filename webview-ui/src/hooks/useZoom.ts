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

interface UseZoomOptions {
    /** Zoom level restored from persisted settings */
    initialZoom?: number;
    /** True once persisted settings have finished loading */
    isSettingsLoaded?: boolean;
    /** Called whenever the user changes the zoom level, for persistence */
    onZoomChange?: (zoom: number) => void;
}

export function useZoom({ initialZoom, isSettingsLoaded, onZoomChange }: UseZoomOptions = {}) {
    const [zoom, setZoom] = useState(DEFAULT_ZOOM);
    const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
    const [isHudVisible, setIsHudVisible] = useState(false);

    // The clipping viewport (.video-container) and the transformed wrapper (.zoom-content)
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);

    const hudTimerRef = useRef<number | null>(null);
    const hasHydratedRef = useRef(false);

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

    // ===== Pan clamping =====

    /**
     * Limit the pan offset so the scaled content can never be dragged fully out
     * of view. The maximum travel on each axis is half of the overflow.
     */
    const clampPan = useCallback((offset: PanOffset, level: number): PanOffset => {
        const viewport = viewportRef.current;
        const content = contentRef.current;
        if (!viewport || !content) {
            return offset;
        }

        // offsetWidth/Height are layout sizes, unaffected by the CSS transform
        const maxX = Math.max(0, (content.offsetWidth * level - viewport.clientWidth) / 2);
        const maxY = Math.max(0, (content.offsetHeight * level - viewport.clientHeight) / 2);

        return {
            x: Math.min(maxX, Math.max(-maxX, offset.x)),
            y: Math.min(maxY, Math.max(-maxY, offset.y)),
        };
    }, []);

    // ===== Zoom actions =====

    const applyZoom = useCallback(
        (nextZoom: number, nextPan: PanOffset) => {
            // A deliberate user change always wins over a late settings hydration
            hasHydratedRef.current = true;
            setZoom(nextZoom);
            setPan(clampPan(nextPan, nextZoom));
            showHud();
            onZoomChange?.(nextZoom);
        },
        [clampPan, showHud, onZoomChange]
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
            const currentZoom = zoom;
            const nextZoom = nextStep(currentZoom, direction);

            if (nextZoom === currentZoom) {
                showHud(); // Already at a limit - still surface the HUD as feedback
                return;
            }

            if (!viewport) {
                applyZoom(nextZoom, pan);
                return;
            }

            const rect = viewport.getBoundingClientRect();
            const cursorX = clientX - (rect.left + rect.width / 2);
            const cursorY = clientY - (rect.top + rect.height / 2);
            const ratio = nextZoom / currentZoom;

            applyZoom(nextZoom, {
                x: cursorX - (cursorX - pan.x) * ratio,
                y: cursorY - (cursorY - pan.y) * ratio,
            });
        },
        [zoom, pan, applyZoom, showHud]
    );

    /** Zoom one step from the centre of the viewport (HUD buttons) */
    const zoomByStep = useCallback(
        (direction: 1 | -1) => {
            const currentZoom = zoom;
            const nextZoom = nextStep(currentZoom, direction);

            if (nextZoom === currentZoom) {
                showHud();
                return;
            }

            const ratio = nextZoom / currentZoom;
            applyZoom(nextZoom, { x: pan.x * ratio, y: pan.y * ratio });
        },
        [zoom, pan, applyZoom, showHud]
    );

    const zoomIn = useCallback(() => zoomByStep(1), [zoomByStep]);
    const zoomOut = useCallback(() => zoomByStep(-1), [zoomByStep]);

    const resetZoom = useCallback(() => {
        applyZoom(DEFAULT_ZOOM, { x: 0, y: 0 });
    }, [applyZoom]);

    /** Move the view by a mouse-drag delta (does not touch the HUD) */
    const panBy = useCallback(
        (deltaX: number, deltaY: number) => {
            setPan((previous) =>
                clampPan({ x: previous.x + deltaX, y: previous.y + deltaY }, zoom)
            );
        },
        [clampPan, zoom]
    );

    // Re-clamp when the viewport resizes so the content cannot get stranded off-screen
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const observer = new ResizeObserver(() => {
            setPan((previous) => clampPan(previous, zoom));
        });
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [clampPan, zoom]);

    // Restore the persisted zoom level once, after settings finish loading
    useEffect(() => {
        if (!isSettingsLoaded || hasHydratedRef.current) return;
        hasHydratedRef.current = true;
        if (typeof initialZoom === 'number') {
            setZoom(clampZoom(initialZoom));
        }
    }, [isSettingsLoaded, initialZoom]);

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
        showHud,
        holdHud,
    };
}
