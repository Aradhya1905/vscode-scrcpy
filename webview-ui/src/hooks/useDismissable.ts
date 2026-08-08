import { useEffect, useRef } from 'react';

/**
 * Escape / outside-pointerdown dismissal for a transient overlay.
 *
 * Returns a ref that must be attached to the element that *contains both the
 * trigger and the overlay*. Scoping it that way is what stops the "click the
 * trigger while open" double-toggle: the outside handler fires first and
 * closes, then the trigger's own onClick re-opens it.
 *
 * Whatever had focus when the overlay opened gets it back on close, so
 * keyboard users are not dumped at the top of the document.
 */
export function useDismissable<T extends HTMLElement = HTMLElement>(
    isOpen: boolean,
    onClose: () => void
) {
    const containerRef = useRef<T | null>(null);
    const triggerRef = useRef<HTMLElement | null>(null);

    // Read through a ref so an unstable onClose doesn't rebind the listeners
    // on every render of the owning component.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        triggerRef.current = document.activeElement as HTMLElement | null;

        return () => {
            const trigger = triggerRef.current;
            triggerRef.current = null;
            // The trigger can be unmounted by the time we close (a panel that
            // navigates away, a device that disappears from the list).
            if (trigger && document.contains(trigger)) {
                trigger.focus();
            }
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onCloseRef.current();
            }
        };

        const handlePointerDown = (event: PointerEvent) => {
            const container = containerRef.current;
            if (container && !container.contains(event.target as Node)) {
                onCloseRef.current();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('pointerdown', handlePointerDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('pointerdown', handlePointerDown);
        };
    }, [isOpen]);

    return containerRef;
}
