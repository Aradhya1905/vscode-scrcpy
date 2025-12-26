/// <reference types="vite/client" />

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState<T>(state: T): T;
};
