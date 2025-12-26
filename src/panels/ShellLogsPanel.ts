import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AdbShellService } from '../services/AdbShellService';
import { AdbLogcatService } from '../services/AdbLogcatService';
import { DeviceManager } from '../services/DeviceManager';

export class ShellLogsPanel {
    public static currentPanel: ShellLogsPanel | undefined;
    public static readonly viewType = 'scrcpyShellLogs';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _context: vscode.ExtensionContext;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private _shellService: AdbShellService;
    private _logcatService: AdbLogcatService;
    private _deviceManager: DeviceManager;

    private _currentDeviceId: string | null = null;

    public static createOrShow(context: vscode.ExtensionContext): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ShellLogsPanel.currentPanel) {
            ShellLogsPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ShellLogsPanel.viewType,
            'ADB Shell & Logs',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri],
            }
        );

        ShellLogsPanel.currentPanel = new ShellLogsPanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._context = context;
        this._extensionUri = context.extensionUri;

        this._shellService = new AdbShellService(context);
        this._logcatService = new AdbLogcatService(context);

        this._deviceManager = new DeviceManager(context, {
            onDeviceList: (devices) => {
                this._postMessage({ type: 'device-list', devices });
            },
            onError: (error) => {
                this._postMessage({ type: 'error', message: error });
            },
        });

        this._logcatService.onLogEntry((entry) => {
            this._postMessage({ type: 'logcat-entry', entry });
        });

        this._logcatService.onCrash((crash) => {
            this._postMessage({ type: 'crash-detected', crash });
        });

        this._logcatService.onError((error) => {
            this._postMessage({ type: 'logcat-error', error });
        });

        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                await this._handleMessage(message);
            },
            null,
            this._disposables
        );
    }

    private async _handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'ready':
                await this._onReady();
                break;
            case 'get-device-list':
                await this._deviceManager.refreshDeviceList();
                break;
            case 'select-device':
                await this._selectDevice(message.deviceId);
                break;

            // Shell
            case 'shell-execute':
                await this._executeShellCommand(message.shellCommand);
                break;
            case 'shell-get-quick-commands':
                this._sendQuickCommands();
                break;
            case 'shell-get-history':
                this._sendHistory();
                break;
            case 'shell-clear-history':
                this._shellService.clearHistory();
                this._sendHistory();
                break;
            case 'shell-get-suggestions':
                this._sendSuggestions(message.partial);
                break;

            // Logcat
            case 'logcat-start':
                await this._startLogcat(message);
                break;
            case 'logcat-stop':
                this._logcatService.stopStreaming();
                this._postMessage({ type: 'logcat-stopped' });
                break;
            case 'logcat-clear':
                if (this._currentDeviceId) {
                    await this._logcatService.clearLogs(this._currentDeviceId);
                    this._postMessage({ type: 'logcat-cleared' });
                }
                break;
            case 'logcat-get-apps':
                await this._sendAppsList();
                break;
            case 'logcat-get-packages':
                await this._sendPackagesList();
                break;
        }
    }

    private async _onReady(): Promise<void> {
        await this._deviceManager.refreshDeviceList();
        this._sendQuickCommands();
        this._sendHistory();

        // Try to auto-select a preferred device (if available)
        try {
            const deviceId = (await this._deviceManager.getPreferredDevice()) || null;
            if (deviceId) {
                await this._selectDevice(deviceId);
            }
        } catch {
            // ignore
        }
    }

    private async _selectDevice(deviceId: string): Promise<void> {
        this._currentDeviceId = deviceId;
        await this._deviceManager.selectDevice(deviceId);

        // Stop any existing logcat stream
        this._logcatService.stopStreaming();
        this._postMessage({ type: 'logcat-stopped' });

        this._postMessage({ type: 'device-selected', deviceId });
    }

    private async _executeShellCommand(command: string): Promise<void> {
        const safeCmd = typeof command === 'string' ? command : '';

        if (!this._currentDeviceId) {
            this._postMessage({
                type: 'shell-output',
                result: {
                    command: safeCmd,
                    stdout: '',
                    stderr: 'No device selected',
                    exitCode: 1,
                    duration: 0,
                },
            });
            return;
        }

        try {
            const result = await this._shellService.executeCommand(this._currentDeviceId, safeCmd);
            this._postMessage({ type: 'shell-output', result });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._postMessage({
                type: 'shell-output',
                result: {
                    command: safeCmd,
                    stdout: '',
                    stderr: msg,
                    exitCode: 1,
                    duration: 0,
                },
            });
        }
    }

    private _sendQuickCommands(): void {
        const commands = this._shellService.getQuickCommands();
        this._postMessage({ type: 'shell-quick-commands', commands });
    }

    private _sendHistory(): void {
        const history = this._shellService.getHistory();
        this._postMessage({ type: 'shell-history', history });
    }

    private _sendSuggestions(partial: string): void {
        const suggestions = this._shellService.getCommandSuggestions(partial || '');
        this._postMessage({ type: 'shell-suggestions', suggestions });
    }

    private async _startLogcat(options: any): Promise<void> {
        if (!this._currentDeviceId) {
            this._postMessage({ type: 'logcat-error', error: 'No device selected' });
            return;
        }

        try {
            await this._logcatService.startStreaming(this._currentDeviceId, {
                packageName: options?.packageName,
                logLevel: options?.logLevel,
                buffers: options?.buffers || ['main', 'crash'],
                clear: options?.clear,
            });
            this._postMessage({ type: 'logcat-started' });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._postMessage({ type: 'logcat-error', error: msg });
        }
    }

    private async _sendAppsList(): Promise<void> {
        if (!this._currentDeviceId) return;
        try {
            const apps = await this._logcatService.getRunningApps(this._currentDeviceId);
            this._postMessage({ type: 'logcat-apps', apps });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._postMessage({ type: 'logcat-error', error: msg });
        }
    }

    private async _sendPackagesList(): Promise<void> {
        if (!this._currentDeviceId) return;
        try {
            const packages = await this._logcatService.getInstalledPackages(
                this._currentDeviceId,
                true
            );
            this._postMessage({ type: 'logcat-packages', packages });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._postMessage({ type: 'logcat-error', error: msg });
        }
    }

    private _postMessage(message: any): void {
        void this._panel.webview.postMessage(message);
    }

    private _getHtmlForWebview(): string {
        const styleUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'build', 'webview.css')
        );
        const scriptUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'build', 'webview.js')
        );

        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'webview.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        const initialState = {
            view: 'shellLogs',
        };

        html = html.replace(/{{styleUri}}/g, styleUri.toString());
        html = html.replace(/{{scriptUri}}/g, scriptUri.toString());
        html = html.replace(/{{cspSource}}/g, this._panel.webview.cspSource);
        html = html.replace(/{{viewMode}}/g, 'panel');
        html = html.replace(/{{initialState}}/g, JSON.stringify(initialState));

        return html;
    }

    public dispose(): void {
        ShellLogsPanel.currentPanel = undefined;

        this._logcatService.dispose();
        this._panel.dispose();

        while (this._disposables.length) {
            const d = this._disposables.pop();
            d?.dispose();
        }
    }
}
