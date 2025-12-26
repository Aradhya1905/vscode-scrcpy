import { useEffect, useCallback } from 'react';
import { vscode } from '../vscode';
import type { ExtensionMessage, WebviewMessage } from '../types';

export function useVSCodeMessages(onMessage: (message: ExtensionMessage) => void) {
    useEffect(() => {
        const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
            onMessage(event.data);
        };

        window.addEventListener('message', handleMessage);

        // Notify extension that webview is ready
        vscode.postMessage({ command: 'ready' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [onMessage]);

    const postMessage = useCallback((message: WebviewMessage) => {
        vscode.postMessage(message);
    }, []);

    return { postMessage };
}
