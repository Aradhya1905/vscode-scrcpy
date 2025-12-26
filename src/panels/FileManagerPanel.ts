import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { DeviceManager } from '../services/DeviceManager';
import { DeviceFileService } from '../services/DeviceFileService';

export class FileManagerPanel {
    public static currentPanel: FileManagerPanel | undefined;
    public static readonly viewType = 'scrcpyFileManager';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _context: vscode.ExtensionContext;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private _deviceManager: DeviceManager | null = null;
    private _fileService: DeviceFileService;
    private readonly _cacheDir: vscode.Uri;

    public static createOrShow(context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (FileManagerPanel.currentPanel) {
            FileManagerPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            FileManagerPanel.viewType,
            'Device File Manager',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri, context.globalStorageUri],
            }
        );

        FileManagerPanel.currentPanel = new FileManagerPanel(panel, context);
    }

    public static kill() {
        FileManagerPanel.currentPanel?._panel.dispose();
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._context = context;
        this._extensionUri = context.extensionUri;
        this._fileService = new DeviceFileService();
        this._cacheDir = vscode.Uri.joinPath(context.globalStorageUri, 'file-manager-cache');

        this._deviceManager = new DeviceManager(context, {
            onDeviceList: (devices) => {
                this._panel.webview.postMessage({ type: 'device-list', devices });
            },
            onError: (error) => {
                this._panel.webview.postMessage({ type: 'error', message: error });
            },
        });

        this._panel.webview.html = this._getHtmlForWebview();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'ready':
                        await this._handleReady();
                        break;
                    case 'get-device-list':
                        await this._deviceManager?.refreshDeviceList();
                        break;
                    case 'select-device':
                        await this._handleSelectDevice(message.deviceId);
                        break;
                    case 'fm-list-dir':
                        await this._handleListDir(message.path, message.deviceId);
                        break;
                    case 'fm-open-file':
                        await this._handleOpenFile(message.path, message.deviceId);
                        break;
                    case 'fm-delete':
                        await this._handleDelete(
                            message.path,
                            message.isDir === true,
                            message.deviceId
                        );
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async _handleReady() {
        await this._deviceManager?.refreshDeviceList();

        // Try to resolve a preferred device and tell the UI, so it can auto-load listings.
        try {
            const deviceId = (await this._deviceManager?.getPreferredDevice()) || null;
            if (deviceId) {
                await this._deviceManager?.selectDevice(deviceId);
                this._panel.webview.postMessage({ type: 'device-selected', deviceId });
            }
        } catch {
            // Ignore; UI will show "no device selected" until user picks one.
        }
    }

    private async _handleSelectDevice(deviceId: string) {
        if (!this._deviceManager) return;
        await this._deviceManager.selectDevice(deviceId);
        this._panel.webview.postMessage({ type: 'device-selected', deviceId });
    }

    private async _handleListDir(dirPath: string, requestedDeviceId?: string) {
        const deviceId =
            requestedDeviceId ||
            this._deviceManager?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            const msg =
                'No Android device connected. Connect a device (adb devices) and try again.';
            this._panel.webview.postMessage({ type: 'error', message: msg });
            vscode.window.showErrorMessage(msg);
            return;
        }

        try {
            const normalizedPath =
                typeof dirPath === 'string' && dirPath.trim() ? dirPath.trim() : '/';
            const entries = await this._fileService.listDir(deviceId, normalizedPath);
            this._panel.webview.postMessage({
                type: 'fm-dir',
                deviceId,
                path: normalizedPath,
                entries,
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._panel.webview.postMessage({
                type: 'error',
                message: `Failed to list "${dirPath}": ${msg}`,
            });
        }
    }

    private async _handleOpenFile(remotePath: string, requestedDeviceId?: string) {
        const deviceId =
            requestedDeviceId ||
            this._deviceManager?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            const msg =
                'No Android device connected. Connect a device (adb devices) and try again.';
            this._panel.webview.postMessage({
                type: 'fm-open-result',
                success: false,
                message: msg,
            });
            vscode.window.showErrorMessage(msg);
            return;
        }

        const rp = typeof remotePath === 'string' ? remotePath.trim() : '';
        if (!rp) {
            this._panel.webview.postMessage({
                type: 'fm-open-result',
                success: false,
                message: 'Missing file path',
            });
            return;
        }

        try {
            await vscode.workspace.fs.createDirectory(this._cacheDir);

            const fileName = DeviceFileService.makeCacheFileName(rp);
            const localFsPath = path.join(this._cacheDir.fsPath, fileName);

            if (fs.existsSync(localFsPath)) {
                try {
                    fs.unlinkSync(localFsPath);
                } catch {
                    // ignore
                }
            }

            await this._fileService.pullFile(deviceId, rp, localFsPath);

            // Open in OS default app (Windows will show "Open with..." if no association exists).
            const ok = await vscode.env.openExternal(vscode.Uri.file(localFsPath));
            if (!ok) {
                await this._openWithOsDefault(localFsPath);
            }

            this._panel.webview.postMessage({
                type: 'fm-open-result',
                success: true,
                message: 'Opening file...',
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._panel.webview.postMessage({
                type: 'fm-open-result',
                success: false,
                message: msg,
            });
            vscode.window.showErrorMessage(`Failed to open file: ${msg}`);
        }
    }

    private async _handleDelete(remotePath: string, isDir: boolean, requestedDeviceId?: string) {
        const deviceId =
            requestedDeviceId ||
            this._deviceManager?.getCurrentDeviceId() ||
            (await this._deviceManager?.getPreferredDevice()) ||
            null;

        if (!deviceId) {
            const msg =
                'No Android device connected. Connect a device (adb devices) and try again.';
            this._panel.webview.postMessage({
                type: 'fm-delete-result',
                success: false,
                message: msg,
            });
            vscode.window.showErrorMessage(msg);
            return;
        }

        const rp = typeof remotePath === 'string' ? remotePath.trim() : '';
        if (!rp) {
            this._panel.webview.postMessage({
                type: 'fm-delete-result',
                success: false,
                message: 'Missing file path',
            });
            return;
        }

        try {
            await this._fileService.deletePath(deviceId, rp, isDir);
            this._panel.webview.postMessage({
                type: 'fm-delete-result',
                success: true,
                message: 'Deleted.',
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._panel.webview.postMessage({
                type: 'fm-delete-result',
                success: false,
                message: msg,
            });
            vscode.window.showErrorMessage(`Failed to delete: ${msg}`);
        }
    }

    private _openWithOsDefault(localFsPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const platform = process.platform;

            if (platform === 'win32') {
                // cmd.exe start uses default app association; if none, Windows prompts "Open with..."
                const child = spawn('cmd.exe', ['/c', 'start', '', localFsPath], {
                    windowsHide: true,
                });
                child.on('error', reject);
                child.on('close', (code) =>
                    code === 0 ? resolve() : reject(new Error(`start exited with code ${code}`))
                );
                return;
            }

            if (platform === 'darwin') {
                const child = spawn('open', [localFsPath]);
                child.on('error', reject);
                child.on('close', (code) =>
                    code === 0 ? resolve() : reject(new Error(`open exited with code ${code}`))
                );
                return;
            }

            const child = spawn('xdg-open', [localFsPath]);
            child.on('error', reject);
            child.on('close', (code) =>
                code === 0 ? resolve() : reject(new Error(`xdg-open exited with code ${code}`))
            );
        });
    }

    private _getHtmlForWebview(): string {
        const fs = require('fs');

        const styleUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'build', 'webview.css')
        );
        const scriptUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'build', 'webview.js')
        );

        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'webview.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        const initialState = {
            view: 'fileManager',
            defaultPath: '/sdcard',
        };

        html = html.replace(/{{styleUri}}/g, styleUri.toString());
        html = html.replace(/{{scriptUri}}/g, scriptUri.toString());
        html = html.replace(/{{cspSource}}/g, this._panel.webview.cspSource);
        html = html.replace(/{{viewMode}}/g, 'panel');
        html = html.replace(/{{initialState}}/g, JSON.stringify(initialState));

        return html;
    }

    public dispose() {
        FileManagerPanel.currentPanel = undefined;
        this._deviceManager = null;
        this._panel.dispose();

        while (this._disposables.length) {
            const d = this._disposables.pop();
            d?.dispose();
        }
    }
}
