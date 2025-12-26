import type { WebviewApi } from 'vscode-webview';

class VSCodeAPIWrapper {
    private readonly vsCodeApi: WebviewApi<unknown> | undefined;

    constructor() {
        if (typeof acquireVsCodeApi === 'function') {
            this.vsCodeApi = acquireVsCodeApi();
        }
    }

    public postMessage(message: unknown): void {
        if (this.vsCodeApi) {
            this.vsCodeApi.postMessage(message);
        }
    }

    public getState(): unknown {
        if (this.vsCodeApi) {
            return this.vsCodeApi.getState();
        }
        return undefined;
    }

    public setState<T extends unknown>(newState: T): T {
        if (this.vsCodeApi) {
            return this.vsCodeApi.setState(newState);
        }
        return newState;
    }
}

export const vscode = new VSCodeAPIWrapper();
