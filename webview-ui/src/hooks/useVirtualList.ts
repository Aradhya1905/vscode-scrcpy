import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Windowing for long, append-heavy lists whose rows are *not* a fixed height.
 *
 * Log rows wrap (`white-space: pre-wrap`), hide their meta line when grouped, and
 * grow when expanded, so a fixed row height would misplace every row after the
 * first wrapped one. Instead each rendered row reports its real height through a
 * ResizeObserver; unmeasured rows fall back to `estimateHeight` until they scroll
 * into view once. Rows outside the window are replaced by two spacer divs, which
 * keeps the existing CSS (margins, borders, padding) working untouched.
 */

export interface VirtualWindow {
    /** First index to render. */
    startIndex: number;
    /** One past the last index to render. */
    endIndex: number;
    /** Height of the spacer standing in for rows before `startIndex`. */
    paddingTop: number;
    /** Height of the spacer standing in for rows from `endIndex` on. */
    paddingBottom: number;
}

export interface UseVirtualListOptions {
    count: number;
    /**
     * Stable identity for a row. Heights are cached against it, so a row keeps its
     * measurement when filtering reorders the list.
     */
    getKey: (index: number) => string;
    estimateHeight: number;
    /** Extra pixels rendered above and below the viewport. */
    overscanPx?: number;
}

export interface UseVirtualList {
    scrollRef: React.RefObject<HTMLDivElement>;
    window: VirtualWindow;
    totalHeight: number;
    /** Ref callback for a row element. Cached per key so refs stay stable. */
    measureRef: (key: string) => (element: HTMLElement | null) => void;
    handleScroll: () => void;
    scrollToBottom: () => void;
}

const DEFAULT_OVERSCAN_PX = 600;

/** Row height including margins - the spacers have to account for those too. */
function measureElement(element: HTMLElement): number {
    const style = window.getComputedStyle(element);
    const marginTop = parseFloat(style.marginTop) || 0;
    const marginBottom = parseFloat(style.marginBottom) || 0;
    return element.getBoundingClientRect().height + marginTop + marginBottom;
}

/** Largest index whose offset is <= `target`, clamped into [0, count - 1]. */
function findIndexForOffset(offsets: Float64Array, count: number, target: number): number {
    let low = 0;
    let high = count - 1;
    let result = 0;

    while (low <= high) {
        const mid = (low + high) >> 1;
        if (offsets[mid] <= target) {
            result = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return result;
}

export function useVirtualList({
    count,
    getKey,
    estimateHeight,
    overscanPx = DEFAULT_OVERSCAN_PX,
}: UseVirtualListOptions): UseVirtualList {
    const scrollRef = useRef<HTMLDivElement>(null);

    const heightsRef = useRef<Map<string, number>>(new Map());
    const elementsRef = useRef<Map<string, HTMLElement>>(new Map());
    const keysByElementRef = useRef<Map<Element, string>>(new Map());
    const refCacheRef = useRef<Map<string, (element: HTMLElement | null) => void>>(new Map());
    const observerRef = useRef<ResizeObserver | null>(null);

    const [viewport, setViewport] = useState({ scrollTop: 0, clientHeight: 0 });
    const [measureVersion, setMeasureVersion] = useState(0);

    const measureFrameRef = useRef<number | null>(null);
    const scrollFrameRef = useRef<number | null>(null);

    const flushMeasurements = useCallback(() => {
        if (measureFrameRef.current !== null) {
            return;
        }
        measureFrameRef.current = requestAnimationFrame(() => {
            measureFrameRef.current = null;
            setMeasureVersion((version) => version + 1);
        });
    }, []);

    const recordHeight = useCallback(
        (key: string, height: number) => {
            if (heightsRef.current.get(key) === height) {
                return;
            }
            heightsRef.current.set(key, height);
            flushMeasurements();
        },
        [flushMeasurements]
    );

    // One observer for every row; rows register and deregister through measureRef.
    useEffect(() => {
        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const key = keysByElementRef.current.get(entry.target);
                if (key !== undefined) {
                    recordHeight(key, measureElement(entry.target as HTMLElement));
                }
            }
        });

        observerRef.current = observer;

        return () => {
            observer.disconnect();
            observerRef.current = null;
            elementsRef.current.clear();
            keysByElementRef.current.clear();
        };
    }, [recordHeight]);

    useEffect(() => {
        return () => {
            if (measureFrameRef.current !== null) {
                cancelAnimationFrame(measureFrameRef.current);
            }
            if (scrollFrameRef.current !== null) {
                cancelAnimationFrame(scrollFrameRef.current);
            }
        };
    }, []);

    const measureRef = useCallback(
        (key: string) => {
            const cached = refCacheRef.current.get(key);
            if (cached) {
                return cached;
            }

            const callback = (element: HTMLElement | null) => {
                const previous = elementsRef.current.get(key);
                if (previous && previous !== element) {
                    observerRef.current?.unobserve(previous);
                    keysByElementRef.current.delete(previous);
                    elementsRef.current.delete(key);
                }

                if (!element) {
                    return;
                }

                elementsRef.current.set(key, element);
                keysByElementRef.current.set(element, key);
                observerRef.current?.observe(element);
                recordHeight(key, measureElement(element));
            };

            refCacheRef.current.set(key, callback);
            return callback;
        },
        [recordHeight]
    );

    const readViewport = useCallback(() => {
        const element = scrollRef.current;
        if (!element) {
            return;
        }
        const { scrollTop, clientHeight } = element;
        setViewport((previous) =>
            previous.scrollTop === scrollTop && previous.clientHeight === clientHeight
                ? previous
                : { scrollTop, clientHeight }
        );
    }, []);

    const handleScroll = useCallback(() => {
        if (scrollFrameRef.current !== null) {
            return;
        }
        scrollFrameRef.current = requestAnimationFrame(() => {
            scrollFrameRef.current = null;
            readViewport();
        });
    }, [readViewport]);

    // clientHeight starts at 0, which would window down to a single row on the
    // first paint. Read it before the browser paints instead.
    useLayoutEffect(() => {
        readViewport();
    });

    useEffect(() => {
        const element = scrollRef.current;
        if (!element || typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(() => readViewport());
        observer.observe(element);
        return () => observer.disconnect();
    }, [readViewport]);

    const layout = useMemo(() => {
        const heights = heightsRef.current;
        const offsets = new Float64Array(count + 1);
        const liveKeys = count > 0 && heights.size > count * 4 ? new Set<string>() : null;

        let total = 0;
        for (let index = 0; index < count; index++) {
            const key = getKey(index);
            liveKeys?.add(key);
            offsets[index] = total;
            total += heights.get(key) ?? estimateHeight;
        }
        offsets[count] = total;

        // Keys are per-entry ids that keep incrementing, so drop measurements for
        // rows that have already aged out of the retained window.
        if (liveKeys) {
            for (const key of heights.keys()) {
                if (!liveKeys.has(key)) {
                    heights.delete(key);
                    refCacheRef.current.delete(key);
                }
            }
        }

        return { offsets, total };
        // measureVersion is the signal that heightsRef changed under us.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count, getKey, estimateHeight, measureVersion]);

    const virtualWindow = useMemo<VirtualWindow>(() => {
        if (count === 0) {
            return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
        }

        const { offsets, total } = layout;
        const top = Math.max(0, viewport.scrollTop - overscanPx);
        const bottom = viewport.scrollTop + viewport.clientHeight + overscanPx;

        const startIndex = findIndexForOffset(offsets, count, top);
        const endIndex = Math.min(count, findIndexForOffset(offsets, count, bottom) + 1);

        return {
            startIndex,
            endIndex,
            paddingTop: offsets[startIndex],
            paddingBottom: Math.max(0, total - offsets[endIndex]),
        };
    }, [layout, viewport, count, overscanPx]);

    const scrollToBottom = useCallback(() => {
        const element = scrollRef.current;
        if (element) {
            element.scrollTop = element.scrollHeight;
        }
    }, []);

    return {
        scrollRef,
        window: virtualWindow,
        totalHeight: layout.total,
        measureRef,
        handleScroll,
        scrollToBottom,
    };
}
