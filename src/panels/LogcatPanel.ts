import * as vscode from 'vscode';
import * as fs from 'fs';
import { AdbLogcatService } from '../services/AdbLogcatService';
import { DeviceManager } from '../services/DeviceManager';

export class LogcatPanel {
    public static currentPanel: LogcatPanel | undefined;
    public static readonly viewType = 'scrcpyLogcat';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _context: vscode.ExtensionContext;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private _logcatService: AdbLogcatService;
    private _deviceManager: DeviceManager;

    private _currentDeviceId: string | null = null;

    public static createOrShow(context: vscode.ExtensionContext): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (LogcatPanel.currentPanel) {
            LogcatPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            LogcatPanel.viewType,
            'ADB Logcat',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri],
            }
        );

        LogcatPanel.currentPanel = new LogcatPanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._context = context;
        this._extensionUri = context.extensionUri;

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

            // Logcat
            case 'logcat-start':
                await this._logcatStart(
                    message.packageName,
                    message.logLevel,
                    message.buffers,
                    message.clear
                );
                break;
            case 'logcat-stop':
                await this._logcatStop();
                break;
            case 'logcat-clear':
                await this._logcatClear();
                break;
            case 'logcat-get-packages':
                await this._logcatGetPackages();
                break;
            case 'logcat-get-apps':
                await this._logcatGetApps();
                break;

            default:
                break;
        }
    }

    private async _onReady(): Promise<void> {
        await this._deviceManager.refreshDeviceList();

        // Auto-select first device if available
        const devices = await this._deviceManager.enumerateDevices();
        if (devices.length > 0 && !this._currentDeviceId) {
            await this._selectDevice(devices[0].id);
        }
    }

    private async _selectDevice(deviceId: string): Promise<void> {
        this._currentDeviceId = deviceId;
        await this._deviceManager.selectDevice(deviceId);
        this._postMessage({ type: 'device-selected', deviceId });
    }

    // Logcat
    private async _logcatStart(
        packageName?: string,
        logLevel?: string,
        buffers?: string[],
        clear?: boolean
    ): Promise<void> {
        if (!this._currentDeviceId) {
            this._postMessage({ type: 'logcat-error', error: 'No device selected' });
            return;
        }

        try {
            await this._logcatService.startStreaming(this._currentDeviceId, {
                packageName,
                logLevel: logLevel as any,
                buffers: buffers as any,
                clear,
            });
            this._postMessage({ type: 'logcat-started' });
        } catch (error: any) {
            this._postMessage({ type: 'logcat-error', error: error.message });
        }
    }

    private async _logcatStop(): Promise<void> {
        this._logcatService.stopStreaming();
        this._postMessage({ type: 'logcat-stopped' });
    }

    private async _logcatClear(): Promise<void> {
        if (!this._currentDeviceId) return;
        await this._logcatService.clearLogs(this._currentDeviceId);
        this._postMessage({ type: 'logcat-cleared' });
    }

    private async _logcatGetPackages(): Promise<void> {
        if (!this._currentDeviceId) return;

        try {
            const packages = await this._logcatService.getInstalledPackages(this._currentDeviceId);
            this._postMessage({ type: 'logcat-packages', packages });
        } catch (error: any) {
            console.error('Failed to get packages:', error);
        }
    }

    private async _logcatGetApps(): Promise<void> {
        if (!this._currentDeviceId) return;

        try {
            const apps = await this._logcatService.getRunningApps(this._currentDeviceId);
            this._postMessage({ type: 'logcat-apps', apps });
        } catch (error: any) {
            console.error('Failed to get running apps:', error);
        }
    }

    private _postMessage(message: any): void {
        this._panel.webview.postMessage(message);
    }

    private _getHtmlForWebview(): string {
        const webviewUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.html')
        );

        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.html').fsPath;
        let html = fs.readFileSync(htmlPath, 'utf8');

        const scriptUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'build', 'webview.js')
        );
        const styleUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'build', 'webview.css')
        );

        const cspSource = this._panel.webview.cspSource;

        const initialState = {
            view: 'logcat',
        };

        html = html.replace(/{{styleUri}}/g, styleUri.toString());
        html = html.replace(/{{scriptUri}}/g, scriptUri.toString());
        html = html.replace(/{{cspSource}}/g, cspSource);
        html = html.replace(/{{viewMode}}/g, 'panel');
        html = html.replace(/{{initialState}}/g, JSON.stringify(initialState));

        return html;
    }

    public dispose(): void {
        LogcatPanel.currentPanel = undefined;

        this._logcatService.stopStreaming();
        this._logcatService.dispose();

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
