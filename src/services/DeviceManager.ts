import { spawn, exec } from 'child_process';
import * as vscode from 'vscode';
import { AdbPathResolver } from './AdbPathResolver';

// Helper to kill a process and its children on all platforms
function killProcessTree(pid: number): void {
    try {
        if (process.platform === 'win32') {
            // On Windows, use taskkill to kill the process tree
            exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true });
        } else {
            // On Unix, kill the process group
            try {
                process.kill(-pid, 'SIGKILL');
            } catch {
                // If process group kill fails, try regular kill
                process.kill(pid, 'SIGKILL');
            }
        }
    } catch {
        // Ignore errors if process is already dead
    }
}

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

    // Cache configuration
    private static readonly CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
    private static readonly MAX_CACHE_SIZE = 50; // Maximum number of cached devices

    constructor(context: vscode.ExtensionContext, events: DeviceManagerEvents) {
        this.context = context;
        this.events = events;
        // Load last selected device from storage
        this.currentDeviceId = this.context.globalState.get<string>('scrcpy.lastDeviceId') || null;
    }

    // Clean up expired cache entries and enforce size limit (LRU eviction)
    private _cleanupCache(): void {
        const now = Date.now();

        // Remove expired entries
        for (const [id, entry] of this._nameCache.entries()) {
            if (now - entry.ts > DeviceManager.CACHE_EXPIRY_MS) {
                this._nameCache.delete(id);
            }
        }

        // If still too large, remove oldest entries (LRU eviction)
        if (this._nameCache.size > DeviceManager.MAX_CACHE_SIZE) {
            const entries = Array.from(this._nameCache.entries());
            // Sort by timestamp (oldest first)
            entries.sort((a, b) => a[1].ts - b[1].ts);

            // Remove oldest entries until we're under the limit
            const toRemove = entries.length - DeviceManager.MAX_CACHE_SIZE;
            for (let i = 0; i < toRemove; i++) {
                this._nameCache.delete(entries[i][0]);
            }
        }
    }

    private _titleCase(s: string): string {
        const trimmed = s.trim();
        if (!trimmed) return trimmed;
        return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }

    private _runAdb(args: string[], timeoutMs = 1500): Promise<string> {
        return new Promise((resolve) => {
            const adb = spawn(AdbPathResolver.getAdbCommand(), args, {
                windowsHide: true,
                detached: process.platform !== 'win32', // Enable process group on Unix for proper cleanup
            });
            let output = '';
            let resolved = false;

            const finish = (value: string) => {
                if (resolved) return;
                resolved = true;
                resolve(value);
            };

            const timer = setTimeout(() => {
                if (adb.pid) {
                    killProcessTree(adb.pid);
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
                detached: process.platform !== 'win32',
            });
            let output = '';
            let resolved = false;

            // Add timeout protection for the enumerate operation
            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    if (adb.pid) {
                        killProcessTree(adb.pid);
                    }
                    resolve([]); // Return empty list on timeout
                }
            }, 5000); // 5 second timeout for device enumeration

            adb.stdout.on('data', (data) => {
                output += data.toString();
            });

            adb.on('close', async (code) => {
                if (resolved) return;
                clearTimeout(timeoutId);

                if (code !== 0) {
                    resolved = true;
                    reject(new Error('Failed to enumerate devices'));
                    return;
                }

                const devices: DeviceListItem[] = [];
                const lines = output.split('\n').slice(1); // Skip header

                // Collect device info for parallel name resolution
                const deviceInfos: Array<{
                    id: string;
                    status: 'device' | 'unauthorized' | 'offline';
                    model?: string;
                }> = [];

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

                    deviceInfos.push({ id, status, model });
                }

                // Clean up expired cache entries before processing
                this._cleanupCache();

                // Resolve names in parallel for devices that need resolution
                const now = Date.now();
                const resolvePromises = deviceInfos.map(async ({ id, status, model }) => {
                    let name = model || id;

                    if (status === 'device') {
                        const cached = this._nameCache.get(id);
                        if (cached && now - cached.ts < DeviceManager.CACHE_EXPIRY_MS) {
                            name = cached.name || name;
                            model = cached.model || model;
                        } else {
                            try {
                                const resolvedInfo = await this._resolveDeviceName(id, model);
                                name = resolvedInfo.name || name;
                                model = resolvedInfo.model || model;
                                this._nameCache.set(id, { name, model, ts: now });
                            } catch {
                                // Use fallback name on error
                            }
                        }
                    }

                    return { id, name, model, status };
                });

                try {
                    const resolvedDevices = await Promise.all(resolvePromises);
                    devices.push(...resolvedDevices);
                } catch {
                    // If parallel resolution fails, use basic info
                    for (const { id, status, model } of deviceInfos) {
                        devices.push({ id, name: model || id, model, status });
                    }
                }

                resolved = true;
                resolve(devices);
            });

            adb.on('error', (err) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeoutId);
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
