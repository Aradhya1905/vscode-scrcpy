import FileManagerApp from './apps/FileManagerApp';
import MirrorApp from './apps/MirrorApp';
import ShellLogsApp from './apps/ShellLogsApp';
import LogcatApp from './apps/LogcatApp';

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

    if (view === 'fileManager') return <FileManagerApp />;
    if (view === 'shellLogs') return <ShellLogsApp />;
    if (view === 'logcat') return <LogcatApp />;
    return <MirrorApp />;
}
