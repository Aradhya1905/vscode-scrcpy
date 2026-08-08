import { useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';

/** Accepts both `useRef<T>(null)` and `useRef<T | null>(null)` flavours */
type ElementRef<T> = RefObject<T> | MutableRefObject<T | null>;

interface UseFitScaleOptions<T extends HTMLElement> {
    /** Element to scale. Defaults to the ref this hook returns. */
    elementRef?: ElementRef<T>;
    /** Box the element must fit inside. Defaults to the element's parent. */
    containerRef?: ElementRef<HTMLElement>;
    /** When false the scale stays at `maxScale` (e.g. device skin turned off) */
    enabled?: boolean;
    /** Extra breathing room (px) kept between the element and its container edges */
    gap?: number;
    /** Never scale above this. Defaults to 1 so the design keeps its intended size. */
    maxScale?: number;
    /** Never scale below this, so tiny panels stay legible instead of unreadable. */
    minScale?: number;
}

interface FitScale<T extends HTMLElement> {
    ref: RefObject<T>;
    scale: number;
}

/**
 * Uniformly scales a fixed-size element down so it fits its container.
 *
 * The element keeps its natural layout size; only a `transform: scale()` is
 * applied, so every child (icons, text, notch, side buttons) shrinks together
 * instead of the frame clipping in a narrow sidebar.
 */
export function useFitScale<T extends HTMLElement>({
    elementRef,
    containerRef,
    enabled = true,
    gap = 16,
    maxScale = 1,
    minScale = 0.35,
}: UseFitScaleOptions<T> = {}): FitScale<T> {
    const internalRef = useRef<T>(null);
    // Both flavours behave identically at runtime; only the declared type differs
    const ref = (elementRef ?? internalRef) as RefObject<T>;
    const [scale, setScale] = useState(maxScale);

    useLayoutEffect(() => {
        if (!enabled) {
            setScale(maxScale);
            return;
        }

        const element = ref.current;
        const container = containerRef?.current ?? element?.parentElement;
        if (!element || !container) {
            return;
        }

        const measure = () => {
            // offsetWidth/Height ignore transforms, so this is the unscaled size
            const naturalWidth = element.offsetWidth;
            const naturalHeight = element.offsetHeight;
            if (naturalWidth === 0 || naturalHeight === 0) {
                return;
            }

            const styles = getComputedStyle(container);
            const availableWidth =
                container.clientWidth -
                parseFloat(styles.paddingLeft) -
                parseFloat(styles.paddingRight) -
                gap;
            const availableHeight =
                container.clientHeight -
                parseFloat(styles.paddingTop) -
                parseFloat(styles.paddingBottom) -
                gap;

            const next = Math.min(
                maxScale,
                availableWidth / naturalWidth,
                availableHeight / naturalHeight
            );
            const clamped = Math.max(minScale, next);
            // Round so sub-pixel container jitter doesn't cause render churn
            const rounded = Math.round(clamped * 1000) / 1000;
            setScale((previous) => (previous === rounded ? previous : rounded));
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, containerRef, enabled, gap, maxScale, minScale]);

    return { ref, scale };
}
