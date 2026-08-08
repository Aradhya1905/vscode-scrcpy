import * as vscode from 'vscode';
import { ScrcpyPanel } from './panels/ScrcpyPanel';
import { ScrcpySidebarView } from './views/ScrcpySidebarView';
import { FileManagerPanel } from './panels/FileManagerPanel';
import { ShellLogsPanel } from './panels/ShellLogsPanel';
import { LogcatPanel } from './panels/LogcatPanel';

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

    // Keep legacy commands for backward compatibility
    const startCommand = vscode.commands.registerCommand('vscode-scrcpy.startMirror', () => {
        ScrcpyPanel.createOrShow(context);
    });

    const stopCommand = vscode.commands.registerCommand('vscode-scrcpy.stopMirror', () => {
        ScrcpyPanel.kill();
    });

    const openFileManagerCommand = vscode.commands.registerCommand(
        'vscode-scrcpy.openFileManager',
        () => {
            FileManagerPanel.createOrShow(context);
        }
    );

    const openShellLogsCommand = vscode.commands.registerCommand(
        'vscode-scrcpy.openShellLogs',
        () => {
            ShellLogsPanel.createOrShow(context);
        }
    );

    const openLogcatCommand = vscode.commands.registerCommand('vscode-scrcpy.openLogcat', () => {
        LogcatPanel.createOrShow(context);
    });

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
    ScrcpyPanel.kill();
}
