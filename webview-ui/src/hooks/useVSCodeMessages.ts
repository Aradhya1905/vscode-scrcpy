import { useEffect, useCallback, useRef } from 'react';
import { vscode } from '../vscode';
import type { ExtensionMessage, WebviewMessage } from '../types';

export function useVSCodeMessages(onMessage: (message: ExtensionMessage) => void) {
    // The listener is registered exactly once, for the lifetime of the webview.
    // Routing through a ref keeps `ready` - which kicks off extension-side init -
    // out of reach of a changing callback identity.
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;

    useEffect(() => {
        const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
            onMessageRef.current(event.data);
        };

        window.addEventListener('message', handleMessage);

        // Notify extension that webview is ready
        vscode.postMessage({ command: 'ready' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    const postMessage = useCallback((message: WebviewMessage) => {
        vscode.postMessage(message);
    }, []);

    return { postMessage };
}
