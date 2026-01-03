import { useRef, useCallback, useEffect } from 'react';

// Minimum interval between key events (ms) to prevent flooding
const KEY_DEBOUNCE_MS = 8;

// Android key codes (subset - common keys)
const AndroidKeyCode: Record<string, number> = {
    // Letters
    KeyA: 29,
    KeyB: 30,
    KeyC: 31,
    KeyD: 32,
    KeyE: 33,
    KeyF: 34,
    KeyG: 35,
    KeyH: 36,
    KeyI: 37,
    KeyJ: 38,
    KeyK: 39,
    KeyL: 40,
    KeyM: 41,
    KeyN: 42,
    KeyO: 43,
    KeyP: 44,
    KeyQ: 45,
    KeyR: 46,
    KeyS: 47,
    KeyT: 48,
    KeyU: 49,
    KeyV: 50,
    KeyW: 51,
    KeyX: 52,
    KeyY: 53,
    KeyZ: 54,
    // Numbers
    Digit0: 7,
    Digit1: 8,
    Digit2: 9,
    Digit3: 10,
    Digit4: 11,
    Digit5: 12,
    Digit6: 13,
    Digit7: 14,
    Digit8: 15,
    Digit9: 16,
    // Special chars
    Space: 62,
    Enter: 66,
    Backspace: 67,
    Tab: 61,
    Escape: 111,
    Minus: 69,
    Equal: 70,
    BracketLeft: 71,
    BracketRight: 72,
    Backslash: 73,
    Semicolon: 74,
    Quote: 75,
    Backquote: 68,
    Comma: 55,
    Period: 56,
    Slash: 76,
    // Arrow keys
    ArrowLeft: 21,
    ArrowRight: 22,
    ArrowUp: 19,
    ArrowDown: 20,
    // Modifiers
    ShiftLeft: 59,
    ShiftRight: 60,
    ControlLeft: 113,
    ControlRight: 114,
    AltLeft: 57,
    AltRight: 58,
    MetaLeft: 117,
    MetaRight: 118,
    // Function keys
    F1: 131,
    F2: 132,
    F3: 133,
    F4: 134,
    F5: 135,
    F6: 136,
    F7: 137,
    F8: 138,
    F9: 139,
    F10: 140,
    F11: 141,
    F12: 142,
    // Other
    Delete: 112,
    Home: 122,
    End: 123,
    PageUp: 92,
    PageDown: 93,
    Insert: 124,
    CapsLock: 115,
};

// Android key event meta state flags
const AndroidKeyEventMeta = {
    Shift: 1,
    Alt: 2,
    Ctrl: 4096,
    Meta: 65536,
};

interface UseKeyboardOptions {
    isConnected: boolean;
    onKeyEvent: (action: 'down' | 'up', keyCode: number, metaState: number) => void;
    onLog: (message: string) => void;
    onPasteRequest?: () => void;
}

export function useKeyboard({ isConnected, onKeyEvent, onPasteRequest }: UseKeyboardOptions) {
    const modifierStateRef = useRef(0);
    const lastKeyTimeRef = useRef<Map<string, number>>(new Map());
    const pendingKeyEventsRef = useRef<
        Array<{ action: 'down' | 'up'; keyCode: number; metaState: number; code: string }>
    >([]);
    const rafIdRef = useRef<number | null>(null);

    // Flush pending key events
    const flushKeyEvents = useCallback(() => {
        const events = pendingKeyEventsRef.current;
        pendingKeyEventsRef.current = [];
        rafIdRef.current = null;

        for (const event of events) {
            onKeyEvent(event.action, event.keyCode, event.metaState);
        }
    }, [onKeyEvent]);

    // Cleanup RAF on unmount
    useEffect(() => {
        return () => {
            if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
            }
        };
    }, []);

    const updateModifierState = useCallback((key: string, pressed: boolean): number => {
        let newState = modifierStateRef.current;

        if (key === 'Shift' || key === 'ShiftLeft' || key === 'ShiftRight') {
            newState = pressed
                ? newState | AndroidKeyEventMeta.Shift
                : newState & ~AndroidKeyEventMeta.Shift;
        } else if (key === 'Control' || key === 'ControlLeft' || key === 'ControlRight') {
            newState = pressed
                ? newState | AndroidKeyEventMeta.Ctrl
                : newState & ~AndroidKeyEventMeta.Ctrl;
        } else if (key === 'Alt' || key === 'AltLeft' || key === 'AltRight') {
            newState = pressed
                ? newState | AndroidKeyEventMeta.Alt
                : newState & ~AndroidKeyEventMeta.Alt;
        } else if (key === 'Meta' || key === 'MetaLeft' || key === 'MetaRight') {
            newState = pressed
                ? newState | AndroidKeyEventMeta.Meta
                : newState & ~AndroidKeyEventMeta.Meta;
        }

        modifierStateRef.current = newState;
        return newState;
    }, []);

    const queueKeyEvent = useCallback(
        (action: 'down' | 'up', keyCode: number, metaState: number, code: string) => {
            const now = performance.now();
            const lastTime = lastKeyTimeRef.current.get(code) || 0;

            // Check if we should debounce this key
            if (now - lastTime < KEY_DEBOUNCE_MS) {
                // Coalesce with pending events
                pendingKeyEventsRef.current.push({ action, keyCode, metaState, code });
                if (!rafIdRef.current) {
                    rafIdRef.current = requestAnimationFrame(flushKeyEvents);
                }
                return;
            }

            // Send immediately
            lastKeyTimeRef.current.set(code, now);
            onKeyEvent(action, keyCode, metaState);
        },
        [onKeyEvent, flushKeyEvents]
    );

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            if (!isConnected) return;

            // Intercept Ctrl+V / Cmd+V for paste
            if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
                console.log('[useKeyboard] Ctrl+V detected, triggering paste request');
                event.preventDefault();
                if (onPasteRequest) {
                    onPasteRequest();
                }
                return;
            }

            // Update modifier state
            let newMetaState = modifierStateRef.current;
            if (event.shiftKey !== ((modifierStateRef.current & AndroidKeyEventMeta.Shift) !== 0)) {
                newMetaState = updateModifierState('Shift', event.shiftKey);
            }
            if (event.ctrlKey !== ((modifierStateRef.current & AndroidKeyEventMeta.Ctrl) !== 0)) {
                newMetaState = updateModifierState('Control', event.ctrlKey);
            }
            if (event.altKey !== ((modifierStateRef.current & AndroidKeyEventMeta.Alt) !== 0)) {
                newMetaState = updateModifierState('Alt', event.altKey);
            }
            if (event.metaKey !== ((modifierStateRef.current & AndroidKeyEventMeta.Meta) !== 0)) {
                newMetaState = updateModifierState('Meta', event.metaKey);
            }

            const androidKeyCode = AndroidKeyCode[event.code];

            if (androidKeyCode !== undefined) {
                event.preventDefault();
                queueKeyEvent('down', androidKeyCode, newMetaState, event.code);
            }
        },
        [isConnected, queueKeyEvent, updateModifierState, onPasteRequest]
    );

    const handleKeyUp = useCallback(
        (event: React.KeyboardEvent) => {
            if (!isConnected) return;

            // Update modifier state
            let newMetaState = modifierStateRef.current;
            if (event.shiftKey !== ((modifierStateRef.current & AndroidKeyEventMeta.Shift) !== 0)) {
                newMetaState = updateModifierState('Shift', event.shiftKey);
            }
            if (event.ctrlKey !== ((modifierStateRef.current & AndroidKeyEventMeta.Ctrl) !== 0)) {
                newMetaState = updateModifierState('Control', event.ctrlKey);
            }
            if (event.altKey !== ((modifierStateRef.current & AndroidKeyEventMeta.Alt) !== 0)) {
                newMetaState = updateModifierState('Alt', event.altKey);
            }
            if (event.metaKey !== ((modifierStateRef.current & AndroidKeyEventMeta.Meta) !== 0)) {
                newMetaState = updateModifierState('Meta', event.metaKey);
            }

            const androidKeyCode = AndroidKeyCode[event.code];

            if (androidKeyCode !== undefined) {
                event.preventDefault();
                queueKeyEvent('up', androidKeyCode, newMetaState, event.code);
            }
        },
        [isConnected, queueKeyEvent, updateModifierState]
    );

    const resetModifiers = useCallback(() => {
        modifierStateRef.current = 0;
    }, []);

    return {
        handleKeyDown,
        handleKeyUp,
        resetModifiers,
    };
}
