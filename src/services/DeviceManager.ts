import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { AdbPathResolver } from './AdbPathResolver';

export interface DeviceListItem {
    id: string;
    name: string;
    model?: string;
    status: 'device' | 'unauthorized' | 'offline';
}

export interface DeviceManagerEvents {
    onDeviceList: (devices: DeviceListItem[]) => void;
    onError: (error: string) => void;
}

export class DeviceManager {
    private context: vscode.ExtensionContext;
    private events: DeviceManagerEvents;
    private currentDeviceId: string | null = null;
    private _nameCache = new Map<string, { name: string; model?: string; ts: number }>();

    constructor(context: vscode.ExtensionContext, events: DeviceManagerEvents) {
        this.context = context;
        this.events = events;
        // Load last selected device from storage
        this.currentDeviceId = this.context.globalState.get<string>('scrcpy.lastDeviceId') || null;
    }

    private _titleCase(s: string): string {
        const trimmed = s.trim();
        if (!trimmed) return trimmed;
        return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }

    private _runAdb(args: string[], timeoutMs = 1500): Promise<string> {
        return new Promise((resolve) => {
            const adb = spawn(AdbPathResolver.getAdbCommand(), args, { windowsHide: true });
            let output = '';
            let resolved = false;

            const finish = (value: string) => {
                if (resolved) return;
                resolved = true;
                resolve(value);
            };

            const timer = setTimeout(() => {
                try {
                    adb.kill();
                } catch {
                    // ignore
                }
                finish(output.trim());
            }, timeoutMs);

            adb.stdout.on('data', (data) => {
                output += data.toString();
            });

            adb.on('close', () => {
                clearTimeout(timer);
                finish(output.trim());
            });

            adb.on('error', () => {
                clearTimeout(timer);
                finish('');
            });
        });
    }

    private async _adbShell(
        deviceId: string,
        command: string[],
        timeoutMs = 1500
    ): Promise<string> {
        return this._runAdb(['-s', deviceId, 'shell', ...command], timeoutMs);
    }

    private _cleanValue(v: string): string {
        const s = (v || '').trim();
        if (!s) return '';
        if (s.toLowerCase() === 'null') return '';
        if (s.toLowerCase() === 'unknown') return '';
        return s;
    }

    private async _resolveDeviceName(
        deviceId: string,
        parsedModel?: string
    ): Promise<{ name: string; model?: string }> {
        // Prefer the user-visible device name if available (Android 12+)
        const deviceName = this._cleanValue(
            await this._adbShell(deviceId, ['settings', 'get', 'global', 'device_name'], 1200)
        );
        if (deviceName) {
            return { name: deviceName, model: parsedModel };
        }

        // Next try market name (some OEMs populate this)
        const marketName = this._cleanValue(
            await this._adbShell(deviceId, ['getprop', 'ro.product.marketname'], 1200)
        );
        if (marketName) {
            return { name: marketName, model: parsedModel };
        }

        const brand = this._cleanValue(
            await this._adbShell(deviceId, ['getprop', 'ro.product.brand'], 1200)
        );
        const model =
            this._cleanValue(
                await this._adbShell(deviceId, ['getprop', 'ro.product.model'], 1200)
            ) || (parsedModel ? parsedModel.trim() : '');
        if (brand && model) {
            const b = this._titleCase(brand);
            const name = model.toLowerCase().includes(brand.toLowerCase())
                ? model
                : `${b} ${model}`;
            return { name, model };
        }

        if (model) {
            return { name: model, model };
        }

        const fallback = parsedModel?.trim() || deviceId;
        return { name: fallback, model: parsedModel };
    }

    async enumerateDevices(): Promise<DeviceListItem[]> {
        return new Promise((resolve, reject) => {
            const adb = spawn(AdbPathResolver.getAdbCommand(), ['devices', '-l'], {
                windowsHide: true,
            });
            let output = '';

            adb.stdout.on('data', (data) => {
                output += data.toString();
            });

            adb.on('close', async (code) => {
                if (code !== 0) {
                    reject(new Error('Failed to enumerate devices'));
                    return;
                }

                const devices: DeviceListItem[] = [];
                const lines = output.split('\n').slice(1); // Skip header

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    const parts = trimmed.split(/\s+/);
                    if (parts.length < 2) continue;

                    const id = parts[0];
                    const status = parts[1] as 'device' | 'unauthorized' | 'offline';

                    // Extract model from additional info (if available)
                    let model: string | undefined;
                    for (const part of parts.slice(2)) {
                        if (part.startsWith('model:')) {
                            model = part.replace('model:', '').replace(/_/g, ' ');
                            break;
                        }
                    }

                    let name = model || id;
                    if (status === 'device') {
                        const cached = this._nameCache.get(id);
                        const now = Date.now();
                        if (cached && now - cached.ts < 5 * 60 * 1000) {
                            name = cached.name || name;
                            model = cached.model || model;
                        } else {
                            const resolved = await this._resolveDeviceName(id, model);
                            name = resolved.name || name;
                            model = resolved.model || model;
                            this._nameCache.set(id, { name, model, ts: now });
                        }
                    }

                    devices.push({
                        id,
                        name,
                        model,
                        status,
                    });
                }

                resolve(devices);
            });

            adb.on('error', (err) => {
                reject(new Error(`ADB error: ${err.message}`));
            });
        });
    }

    async refreshDeviceList(): Promise<void> {
        try {
            const devices = await this.enumerateDevices();
            this.events.onDeviceList(devices);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to refresh device list: ${errorMessage}`);
        }
    }

    getCurrentDeviceId(): string | null {
        return this.currentDeviceId;
    }

    async selectDevice(deviceId: string | null): Promise<void> {
        this.currentDeviceId = deviceId;
        if (deviceId) {
            await this.context.globalState.update('scrcpy.lastDeviceId', deviceId);
        } else {
            await this.context.globalState.update('scrcpy.lastDeviceId', undefined);
        }
    }

    async getPreferredDevice(): Promise<string | null> {
        // First check if last selected device is still connected
        if (this.currentDeviceId) {
            const devices = await this.enumerateDevices();
            const device = devices.find(
                (d) => d.id === this.currentDeviceId && d.status === 'device'
            );
            if (device) {
                return device.id;
            }
        }

        // Otherwise, return first available device
        const devices = await this.enumerateDevices();
        const availableDevice = devices.find((d) => d.status === 'device');
        return availableDevice?.id || null;
    }
}
