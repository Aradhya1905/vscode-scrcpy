import * as vscode from 'vscode';
import { ScrcpySidebarView } from './views/ScrcpySidebarView';

// Only the sidebar view provider has to exist at activation. Every panel is loaded
// on first use instead: the mirror panel reaches ScrcpyService and through it the
// @yume-chan protocol stack, which is ~63% of the bundle and pure parse+eval cost
// for a session that never opens a panel.
let scrcpyPanelModule: typeof import('./panels/ScrcpyPanel') | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Register sidebar view provider
    class ScrcpySidebarViewProvider implements vscode.WebviewViewProvider {
        public static readonly viewType = 'scrcpySidebar';

        constructor(private readonly _context: vscode.ExtensionContext) {}

        public resolveWebviewView(
            webviewView: vscode.WebviewView,
            _context: vscode.WebviewViewResolveContext,
            _token: vscode.CancellationToken
        ) {
            ScrcpySidebarView.revive(webviewView, this._context);
        }
    }

    // retainContextWhenHidden is required by the "Persistent Mirroring" setting: without
    // it VS Code tears down the webview DOM when the sidebar is hidden, taking the video
    // decoder and canvas with it, so keeping the stream alive extension-side would be
    // pointless. webviewOptions are fixed at registration time and there is no API to
    // toggle them per-setting, so this is on for everyone - the cost is that the webview
    // stays resident in memory once the sidebar has been opened, even with the setting off.
    const sidebarViewProvider = vscode.window.registerWebviewViewProvider(
        ScrcpySidebarViewProvider.viewType,
        new ScrcpySidebarViewProvider(context),
        { webviewOptions: { retainContextWhenHidden: true } }
    );

    async function loadScrcpyPanel() {
        scrcpyPanelModule ??= await import('./panels/ScrcpyPanel');
        return scrcpyPanelModule.ScrcpyPanel;
    }

    // Keep legacy commands for backward compatibility
    const startCommand = vscode.commands.registerCommand('vscode-scrcpy.startMirror', async () => {
        (await loadScrcpyPanel()).createOrShow(context);
    });

    const stopCommand = vscode.commands.registerCommand('vscode-scrcpy.stopMirror', () => {
        // Nothing to kill if the panel module was never loaded.
        scrcpyPanelModule?.ScrcpyPanel.kill();
    });

    const openFileManagerCommand = vscode.commands.registerCommand(
        'vscode-scrcpy.openFileManager',
        async () => {
            const { FileManagerPanel } = await import('./panels/FileManagerPanel');
            FileManagerPanel.createOrShow(context);
        }
    );

    const openShellLogsCommand = vscode.commands.registerCommand(
        'vscode-scrcpy.openShellLogs',
        async () => {
            const { ShellLogsPanel } = await import('./panels/ShellLogsPanel');
            ShellLogsPanel.createOrShow(context);
        }
    );

    const openLogcatCommand = vscode.commands.registerCommand(
        'vscode-scrcpy.openLogcat',
        async () => {
            const { LogcatPanel } = await import('./panels/LogcatPanel');
            LogcatPanel.createOrShow(context);
        }
    );

    context.subscriptions.push(
        sidebarViewProvider,
        startCommand,
        stopCommand,
        openFileManagerCommand,
        openShellLogsCommand,
        openLogcatCommand
    );
}

export function deactivate() {
    scrcpyPanelModule?.ScrcpyPanel.kill();
}
