import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { ScrcpyService } from '../services/ScrcpyService';
import { DeviceInfoService } from '../services/DeviceInfoService';
import { DeviceManager } from '../services/DeviceManager';
import { AdbShellService } from '../services/AdbShellService';
import { installApks } from '../services/ApkInstaller';
import { FileManagerPanel } from './FileManagerPanel';

export class ScrcpyPanel {
    public static currentPanel: ScrcpyPanel | undefined;
    public static readonly viewType = 'scrcpyMirror';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    private _scrcpyService: ScrcpyService | null = null;
    private _videoBuffer: Buffer[] = [];
    private _videoBufferSize: number = 0; // Track total buffer size in bytes
    private _sendVideoTimeout: NodeJS.Timeout | null = null;
    private _deviceInfoService: DeviceInfoService | null = null;
    private _deviceManager: DeviceManager | null = null;
    private _adbShellService: AdbShellService;

    // Maximum buffer size before dropping frames (2MB)
    private static readonly MAX_VIDEO_BUFFER_SIZE = 2 * 1024 * 1024;

    public static createOrShow(context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ScrcpyPanel.currentPanel) {
            ScrcpyPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ScrcpyPanel.viewType,
            'Android Screen Mirror',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri],
            }
        );

        ScrcpyPanel.currentPanel = new ScrcpyPanel(panel, context);
    }

    public static kill() {
        if (ScrcpyPanel.currentPanel) {
            ScrcpyPanel.currentPanel._scrcpyService?.stop();
            ScrcpyPanel.currentPanel._panel.dispose();
        }
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = context.extensionUri;
        this._context = context;

        this._adbShellService = new AdbShellService(context);

        // Initialize DeviceManager
        this._deviceManager = new DeviceManager(context, {
            onDeviceList: (devices) => {
                this._panel.webview.postMessage({
                    type: 'device-list',
                    devices: devices,
                });
            },
            onError: (error) => {
                console.error('DeviceManager error:', error);
                this._panel.webview.postMessage({
                    type: 'error',
                    message: error,
                });
            },
        });

        // Initialize DeviceInfoService
        this._deviceInfoService = new DeviceInfoService({
            onDeviceInfo: (info) => {
                this._panel.webview.postMessage({
                    type: 'device-info',
                    info: info,
                });
            },
            onError: (error) => {
                console.error('DeviceInfoService error:', error);
            },
        });

        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'start':
                        await this._startStreaming(message.settings);
                        break;
                    case 'stop':
                        this._stopStreaming();
                        break;
                    case 'ready':
                        // Send initial device list
                        await this._deviceManager?.refreshDeviceList();
                        break;
                    case 'touch':
                        this._handleTouchEvent(message);
                        break;
                    case 'key':
                        this._handleKeyEvent(message);
                        break;
                    case 'home':
                        this._handleHome();
                        break;
                    case 'back':
                        this._handleBack();
                        break;
                    case 'app-switch':
                        this._handleAppSwitch();
                        break;
                    case 'screenshot':
                        this._handleScreenshot();
                        break;
                    case 'scroll':
                        this._handleScroll(message);
                        break;
                    case 'get-device-info':
                        this._deviceInfoService?.fetchDeviceInfo();
                        break;
                    case 'get-device-list':
                        await this._deviceManager?.refreshDeviceList();
                        break;
                    case 'select-device':
                        await this._handleSelectDevice(message.deviceId);
                        break;
                    case 'pick-apk-files':
                        await this._handlePickApkFiles();
                        break;
                    case 'install-apk':
                        await this._handleInstallApk(message.files);
                        break;
                    case 'open-file-manager':
                        FileManagerPanel.createOrShow(this._context);
                        break;
                    case 'open-logcat':
                        const { LogcatPanel } = require('./LogcatPanel');
                        LogcatPanel.createOrShow(this._context);
                        break;
                    case 'open-shell-logs':
                        const { ShellLogsPanel } = require('./ShellLogsPanel');
                        ShellLogsPanel.createOrShow(this._context);
                        break;
                    case 'volume-up':
                        await this._handleVolumeUp();
                        break;
                    case 'volume-down':
                        await this._handleVolumeDown();
                        break;
                    case 'lock-screen':
                        await this._handleLockScreen();
                        break;
                    case 'open-camera':
                        await this._handleOpenCamera();
                        break;
                    case 'screen-power-toggle':
                        this._handleScreenPowerToggle(message.screenOff);
                        break;
                    case 'show-touches':
                        await this._handleShowTouches(message.enabled);
                        break;
                    case 'stay-awake':
                        await this._handleStayAwake(message.enabled);
                        break;
                    case 'dark-mode':
                        await this._handleDarkMode(message.enabled);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async _handlePickApkFiles(): Promise<void> {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Select APK(s)',
            filters: { 'Android Package': ['apk'] },
        });

        if (!picked || picked.length === 0) {
            return;
        }

        const paths = picked.map((u) => u.fsPath);
        this._panel.webview.postMessage({ type: 'apk-files-selected', paths });
    }

    private async _handleInstallApk(requestedPaths?: string[]): Promise<void> {
        const deviceId =
            this._scrcpyService?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            const msg =
                'No Android device connected. Connect a device (adb devices) and try again.';
            vscode.window.showErrorMessage(msg);
            this._panel.webview.postMessage({
                type: 'apk-install-result',
                success: false,
                message: msg,
            });
            return;
        }

        const isValidPath = (p: string) => {
            if (!p) return false;
            const lower = p.toLowerCase();
            if (lower.includes('fakepath')) return false;
            if (!lower.endsWith('.apk')) return false;
            return fs.existsSync(p);
        };

        let apkPaths = (requestedPaths || []).filter(isValidPath);

        if (apkPaths.length === 0) {
            const picked = await vscode.window.showOpenDialog({
                canSelectMany: true,
                openLabel: 'Install APK(s)',
                filters: { 'Android Package': ['apk'] },
            });

            if (!picked || picked.length === 0) {
                return;
            }

            apkPaths = picked.map((u) => u.fsPath).filter(isValidPath);
            this._panel.webview.postMessage({ type: 'apk-files-selected', paths: apkPaths });
        }

        if (apkPaths.length === 0) {
            const msg =
                'No valid APK paths were provided. Please pick APK files from the VS Code dialog.';
            vscode.window.showErrorMessage(msg);
            this._panel.webview.postMessage({
                type: 'apk-install-result',
                success: false,
                message: msg,
            });
            return;
        }

        this._panel.webview.postMessage({
            type: 'apk-install-status',
            level: 'info',
            message: `Installing ${apkPaths.length} APK(s) on ${deviceId}...`,
        });

        try {
            await installApks(deviceId, apkPaths);

            const ok = `Installed ${apkPaths.length} APK(s) on ${deviceId}.`;
            vscode.window.showInformationMessage(ok);
            this._panel.webview.postMessage({
                type: 'apk-install-result',
                success: true,
                message: ok,
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`APK install failed: ${msg}`);
            this._panel.webview.postMessage({
                type: 'apk-install-result',
                success: false,
                message: msg,
            });
        }
    }

    private async _startStreaming(settings?: {
        maxSize?: number;
        maxFps?: number;
        videoBitRate?: number;
    }) {
        if (this._scrcpyService?.isActive()) {
            return;
        }

        // Get preferred device or first available
        const deviceId = (await this._deviceManager?.getPreferredDevice()) || null;

        this._scrcpyService = new ScrcpyService(
            {
                onVideoData: (data) => {
                    // Buffer video data and send in batches for better performance
                    // Check buffer size limit to prevent unbounded memory growth
                    if (this._videoBufferSize + data.length > ScrcpyPanel.MAX_VIDEO_BUFFER_SIZE) {
                        // Buffer is too large, drop old frames to make room
                        console.warn(
                            `Video buffer exceeded ${ScrcpyPanel.MAX_VIDEO_BUFFER_SIZE} bytes, dropping old frames`
                        );
                        this._videoBuffer = [];
                        this._videoBufferSize = 0;
                    }

                    this._videoBuffer.push(data);
                    this._videoBufferSize += data.length;

                    if (!this._sendVideoTimeout) {
                        this._sendVideoTimeout = setTimeout(() => {
                            if (this._videoBuffer.length > 0) {
                                const combined = Buffer.concat(this._videoBuffer);
                                this._videoBuffer = [];
                                this._videoBufferSize = 0;
                                // Use base64 encoding instead of Array.from() for much better performance
                                // base64 is ~33% larger but avoids the massive overhead of JSON serializing arrays
                                this._panel.webview.postMessage({
                                    type: 'video',
                                    data: combined.toString('base64'),
                                });
                            }
                            this._sendVideoTimeout = null;
                        }, 8); // ~120fps batching for lower latency
                    }
                },
                onError: (error) => {
                    vscode.window.showErrorMessage(`Scrcpy Error: ${error}`);
                    this._panel.webview.postMessage({
                        type: 'error',
                        message: error,
                    });
                },
                onConnected: () => {
                    const connectedDeviceId = this._scrcpyService?.getCurrentDeviceId();
                    if (connectedDeviceId) {
                        this._deviceInfoService?.setDevice(connectedDeviceId);
                        this._deviceManager?.selectDevice(connectedDeviceId);
                        this._panel.webview.postMessage({
                            type: 'device-selected',
                            deviceId: connectedDeviceId,
                        });
                    }
                    this._panel.webview.postMessage({
                        type: 'connected',
                    });
                },
                onDisconnected: () => {
                    this._deviceInfoService?.setDevice(null);
                    this._panel.webview.postMessage({
                        type: 'disconnected',
                    });
                },
            },
            this._extensionUri.fsPath
        );

        this._panel.webview.postMessage({ type: 'connecting' });
        await this._scrcpyService.start(deviceId, settings);
    }

    private _stopStreaming() {
        if (this._sendVideoTimeout) {
            clearTimeout(this._sendVideoTimeout);
            this._sendVideoTimeout = null;
        }
        this._videoBuffer = [];
        this._videoBufferSize = 0;
        this._scrcpyService?.stop();
        this._scrcpyService = null;
    }

    private _handleTouchEvent(message: any) {
        if (!this._scrcpyService) {
            return;
        }

        const { action, x, y, videoWidth, videoHeight } = message;
        this._scrcpyService.sendTouchEvent(action, x, y, videoWidth, videoHeight);
    }

    private _handleKeyEvent(message: any) {
        if (!this._scrcpyService) {
            return;
        }

        const { action, keyCode, metaState } = message;
        this._scrcpyService.sendKeyEvent(action, keyCode, metaState);
    }

    private _handleHome() {
        if (!this._scrcpyService) {
            return;
        }
        // Android HOME keycode = 3
        this._scrcpyService.sendKeyEvent('down', 3, 0);
        this._scrcpyService.sendKeyEvent('up', 3, 0);
    }

    private _handleBack() {
        if (!this._scrcpyService) {
            return;
        }
        // Android BACK keycode = 4
        this._scrcpyService.sendKeyEvent('down', 4, 0);
        this._scrcpyService.sendKeyEvent('up', 4, 0);
    }

    private _handleAppSwitch() {
        if (!this._scrcpyService) {
            return;
        }
        // Android APP_SWITCH keycode = 187
        this._scrcpyService.sendKeyEvent('down', 187, 0);
        this._scrcpyService.sendKeyEvent('up', 187, 0);
    }

    private async _handleVolumeUp(): Promise<void> {
        const deviceId =
            this._scrcpyService?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            vscode.window.showWarningMessage(
                'No Android device connected. Connect a device (adb devices) and try again.'
            );
            return;
        }

        try {
            const result = await this._adbShellService.executeCommand(
                deviceId,
                'input keyevent 24'
            );
            if (result.exitCode !== 0) {
                const details = result.stderr || result.stdout || `exitCode=${result.exitCode}`;
                vscode.window.showErrorMessage(`Failed to send Volume Up: ${details}`);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to send Volume Up: ${msg}`);
        }
    }

    private async _handleVolumeDown(): Promise<void> {
        const deviceId =
            this._scrcpyService?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            vscode.window.showWarningMessage(
                'No Android device connected. Connect a device (adb devices) and try again.'
            );
            return;
        }

        try {
            const result = await this._adbShellService.executeCommand(
                deviceId,
                'input keyevent 25'
            );
            if (result.exitCode !== 0) {
                const details = result.stderr || result.stdout || `exitCode=${result.exitCode}`;
                vscode.window.showErrorMessage(`Failed to send Volume Down: ${details}`);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to send Volume Down: ${msg}`);
        }
    }

    private async _handleLockScreen(): Promise<void> {
        const deviceId =
            this._scrcpyService?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            vscode.window.showWarningMessage(
                'No Android device connected. Connect a device (adb devices) and try again.'
            );
            return;
        }

        try {
            const result = await this._adbShellService.executeCommand(
                deviceId,
                'input keyevent 26'
            );
            if (result.exitCode !== 0) {
                const details = result.stderr || result.stdout || `exitCode=${result.exitCode}`;
                vscode.window.showErrorMessage(`Failed to lock screen: ${details}`);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to lock screen: ${msg}`);
        }
    }

    private async _handleOpenCamera(): Promise<void> {
        const deviceId =
            this._scrcpyService?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            vscode.window.showWarningMessage(
                'No Android device connected. Connect a device (adb devices) and try again.'
            );
            return;
        }

        try {
            const result = await this._adbShellService.executeCommand(
                deviceId,
                'am start -a android.media.action.IMAGE_CAPTURE'
            );
            if (result.exitCode !== 0) {
                const details = result.stderr || result.stdout || `exitCode=${result.exitCode}`;
                vscode.window.showErrorMessage(`Failed to open camera: ${details}`);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to open camera: ${msg}`);
        }
    }

    private _handleScreenPowerToggle(screenOff: boolean): void {
        if (!this._scrcpyService || !this._scrcpyService.isActive()) {
            vscode.window.showWarningMessage('Connect to a device before toggling screen power.');
            return;
        }

        // Toggle device screen: 0 = off, 2 = normal
        this._scrcpyService.setScreenPowerMode(screenOff ? 0 : 2);
    }

    private async _handleShowTouches(enabled: boolean): Promise<void> {
        const deviceId =
            this._scrcpyService?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            vscode.window.showWarningMessage(
                'No Android device connected. Connect a device (adb devices) and try again.'
            );
            return;
        }

        try {
            const value = enabled ? '1' : '0';
            const result = await this._adbShellService.executeCommand(
                deviceId,
                `settings put system show_touches ${value}`
            );
            if (result.exitCode !== 0) {
                const details = result.stderr || result.stdout || `exitCode=${result.exitCode}`;
                vscode.window.showErrorMessage(`Failed to toggle show touches: ${details}`);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to toggle show touches: ${msg}`);
        }
    }

    private async _handleStayAwake(enabled: boolean): Promise<void> {
        const deviceId =
            this._scrcpyService?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            vscode.window.showWarningMessage(
                'No Android device connected. Connect a device (adb devices) and try again.'
            );
            return;
        }

        try {
            // 3 = stay awake while plugged in via AC, USB, or Wireless
            // 0 = disable stay awake
            const value = enabled ? '3' : '0';
            const result = await this._adbShellService.executeCommand(
                deviceId,
                `settings put global stay_on_while_plugged_in ${value}`
            );
            if (result.exitCode !== 0) {
                const details = result.stderr || result.stdout || `exitCode=${result.exitCode}`;
                vscode.window.showErrorMessage(`Failed to toggle stay awake: ${details}`);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to toggle stay awake: ${msg}`);
        }
    }

    private async _handleDarkMode(enabled: boolean): Promise<void> {
        const deviceId =
            this._scrcpyService?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            vscode.window.showWarningMessage(
                'No Android device connected. Connect a device (adb devices) and try again.'
            );
            return;
        }

        try {
            const mode = enabled ? 'yes' : 'no';
            const result = await this._adbShellService.executeCommand(
                deviceId,
                `cmd uimode night ${mode}`
            );
            if (result.exitCode !== 0) {
                const details = result.stderr || result.stdout || `exitCode=${result.exitCode}`;
                vscode.window.showErrorMessage(`Failed to toggle dark mode: ${details}`);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to toggle dark mode: ${msg}`);
        }
    }

    private async _handleScreenshot() {
        if (!this._scrcpyService || !this._scrcpyService.isActive()) {
            vscode.window.showWarningMessage('Connect to a device before taking a screenshot.');
            return;
        }

        const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
        const defaultFileName = `scrcpy-screenshot-${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}.png`;

        const targetUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(defaultDir, defaultFileName)),
            filters: { 'PNG Image': ['png'] },
            saveLabel: 'Save Screenshot',
        });

        if (!targetUri) {
            return;
        }

        try {
            const image = await this._scrcpyService.captureScreenshot();
            await vscode.workspace.fs.writeFile(targetUri, image);
            vscode.window.showInformationMessage(`Screenshot saved to ${targetUri.fsPath}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to take screenshot: ${message}`);
        }
    }

    private _handleScroll(message: any) {
        if (!this._scrcpyService) {
            return;
        }
        const { x, y, deltaX, deltaY, videoWidth, videoHeight } = message;
        this._scrcpyService.sendScroll(x, y, deltaX, deltaY, videoWidth, videoHeight);
    }

    private async _handleSelectDevice(deviceId: string) {
        if (!this._deviceManager) {
            return;
        }

        // If currently streaming, we need to stop and restart with new device
        const wasStreaming = this._scrcpyService?.isActive();
        if (wasStreaming) {
            this._stopStreaming();
        }

        await this._deviceManager.selectDevice(deviceId);
        this._panel.webview.postMessage({
            type: 'device-selected',
            deviceId: deviceId,
        });

        // If was streaming, restart with new device
        if (wasStreaming) {
            await this._startStreaming();
        }
    }

    public dispose() {
        ScrcpyPanel.currentPanel = undefined;
        this._stopStreaming();
        this._deviceInfoService?.dispose();
        this._deviceInfoService = null;
        this._deviceManager = null;
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getHtmlForWebview(): string {
        const fs = require('fs');
        const path = require('path');

        // Get URIs for React build resources
        const styleUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'build', 'webview.css')
        );
        const scriptUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'build', 'webview.js')
        );

        // Read the HTML template
        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'webview.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Replace placeholders with actual URIs
        html = html.replace(/{{styleUri}}/g, styleUri.toString());
        html = html.replace(/{{scriptUri}}/g, scriptUri.toString());
        html = html.replace(/{{cspSource}}/g, this._panel.webview.cspSource);
        html = html.replace(/{{viewMode}}/g, 'panel');
        html = html.replace(/{{initialState}}/g, '{}');

        return html;
    }

    public postMessage(message: any) {
        this._panel.webview.postMessage(message);
    }
}
