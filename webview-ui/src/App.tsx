import { Suspense, lazy } from 'react';

// One view is mounted per webview, and the extension decides which before the
// bundle loads. Static imports made the sidebar parse and evaluate all four apps
// - plus every lucide icon any of them reference - before it could paint, so each
// app is its own chunk fetched only by the surface that shows it.
const MirrorApp = lazy(() => import('./apps/MirrorApp'));
const FileManagerApp = lazy(() => import('./apps/FileManagerApp'));
const ShellLogsApp = lazy(() => import('./apps/ShellLogsApp'));
const LogcatApp = lazy(() => import('./apps/LogcatApp'));

type InitialState = {
    view?: string;
};

function getInitialState(): InitialState {
    return (window as any).__VSCODE_SCRCPY_INITIAL_STATE__ ?? {};
}

export default function App() {
    const initial = getInitialState();
    const view =
        initial.view === 'fileManager'
            ? 'fileManager'
            : initial.view === 'shellLogs'
              ? 'shellLogs'
              : initial.view === 'logcat'
                ? 'logcat'
                : 'mirror';

    // The chunk is a local file behind a webview-resource URI, so the wait is a
    // disk read - a spinner here would flash more than it would inform.
    return (
        <Suspense fallback={null}>
            {view === 'fileManager' ? (
                <FileManagerApp />
            ) : view === 'shellLogs' ? (
                <ShellLogsApp />
            ) : view === 'logcat' ? (
                <LogcatApp />
            ) : (
                <MirrorApp />
            )}
        </Suspense>
    );
}
