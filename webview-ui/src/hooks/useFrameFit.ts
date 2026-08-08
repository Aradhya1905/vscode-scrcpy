import { useLayoutEffect, useState, type MutableRefObject, type RefObject } from 'react';

/** Accepts both `useRef<T>(null)` and `useRef<T | null>(null)` flavours */
type ElementRef<T> = RefObject<T> | MutableRefObject<T | null>;

interface UseFrameFitOptions {
    /** Box the frame has to fit inside */
    containerRef: ElementRef<HTMLElement>;
    /** Frame width / height, so the fitted height also respects the available width */
    aspectRatio: number;
    /** When false the height stays at `fallbackHeight` (e.g. device skin turned off) */
    enabled?: boolean;
    /** Breathing room (px) kept between the frame and the container's content box */
    gap?: number;
    /** Floor, so the frame stays usable instead of collapsing in a tiny panel */
    minHeight?: number;
    /** Height used while disabled or before the first measurement */
    fallbackHeight?: number;
}

/**
 * Returns the pixel height a fixed-aspect device frame should take to fill its
 * container, growing as well as shrinking.
 *
 * The height is meant to be fed to the `--phone-height` custom property rather
 * than a `transform: scale()`: the frame then lays out at its real size, so the
 * video canvas gets a matching CSS box and stays crisp at any panel width.
 */
export function useFrameFit({
    containerRef,
    aspectRatio,
    enabled = true,
    gap = 8,
    minHeight = 220,
    fallbackHeight = 630,
}: UseFrameFitOptions): number {
    const [height, setHeight] = useState(fallbackHeight);

    useLayoutEffect(() => {
        if (!enabled) {
            setHeight(fallbackHeight);
            return;
        }

        const container = containerRef.current;
        if (!container) {
            return;
        }

        const measure = () => {
            const styles = getComputedStyle(container);
            // clientWidth/Height include padding, so subtract it to get the content box
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
            if (availableWidth <= 0 || availableHeight <= 0) {
                return;
            }

            const fitted = Math.max(
                minHeight,
                Math.min(availableHeight, availableWidth / aspectRatio)
            );
            // Round so sub-pixel container jitter doesn't cause render churn
            const rounded = Math.round(fitted);
            setHeight((previous) => (previous === rounded ? previous : rounded));
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        return () => observer.disconnect();
    }, [containerRef, aspectRatio, enabled, gap, minHeight, fallbackHeight]);

    return height;
}
