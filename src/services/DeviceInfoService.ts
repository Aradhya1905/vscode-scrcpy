import { spawn } from 'child_process';
import { AdbPathResolver } from './AdbPathResolver';

export interface DeviceInfo {
    id: string;
    model: string;
    androidVersion: string;
    sdkVersion: number;
    battery: {
        level: number;
        isCharging: boolean;
        temperature?: number;
    };
    network: {
        connected: boolean;
        type?: 'wifi' | 'cellular' | 'ethernet' | 'none';
        signalStrength?: number; // 0-100 for WiFi
    };
    storage: {
        total: number; // bytes
        available: number; // bytes
        used: number; // bytes
    };
}

export interface DeviceInfoServiceEvents {
    onDeviceInfo: (info: DeviceInfo) => void;
    onError: (error: string) => void;
}

/** Immutable per device, so it is fetched once and never re-polled. */
interface StaticDeviceInfo {
    model: string;
    androidVersion: string;
    sdkVersion: number;
}

/**
 * Network and storage move slowly and cost the heaviest dumpsys targets, so they
 * ride a slower tier than battery.
 */
const SLOW_TIER_MS = 30_000;

const GETPROP_TIMEOUT_MS = 5_000;
const DUMPSYS_TIMEOUT_MS = 10_000;

export class DeviceInfoService {
    private deviceId: string | null = null;
    private pollingInterval: NodeJS.Timeout | null = null;
    private events: DeviceInfoServiceEvents;
    private pollingIntervalMs: number;

    private staticInfo: StaticDeviceInfo | null = null;
    private staticInfoInFlight: Promise<StaticDeviceInfo> | null = null;

    private slowTier: { network: DeviceInfo['network']; storage: DeviceInfo['storage'] } | null =
        null;
    private slowTierAt = 0;

    constructor(events: DeviceInfoServiceEvents, pollingIntervalMs: number = 5000) {
        this.events = events;
        this.pollingIntervalMs = pollingIntervalMs;
    }

    setDevice(deviceId: string | null): void {
        if (deviceId === this.deviceId) {
            // Re-selecting the same device must not restart the timer, which would
            // fire an immediate extra fetch on every reconnect notification.
            if (deviceId && !this.pollingInterval) {
                this.startPolling();
            }
            return;
        }

        this.deviceId = deviceId;
        this.clearCaches();
        if (deviceId) {
            this.startPolling();
        } else {
            this.stopPolling();
        }
    }

    private clearCaches(): void {
        this.staticInfo = null;
        this.staticInfoInFlight = null;
        this.slowTier = null;
        this.slowTierAt = 0;
    }

    /**
     * Stops the poll timer without forgetting the device. Used when the owning
     * webview is hidden, so a backgrounded surface stops spawning adb processes.
     */
    pausePolling(): void {
        this.stopPolling();
    }

    /**
     * Restarts polling if a device is still selected. Fetches once immediately so
     * a revealed webview does not show stale info for up to a full interval.
     */
    resumePolling(): void {
        if (!this.deviceId || this.pollingInterval) {
            return;
        }
        this.startPolling();
    }

    private startPolling(): void {
        this.stopPolling();
        // Fetch immediately
        this.fetchDeviceInfo();
        // Then poll at interval
        this.pollingInterval = setInterval(() => {
            this.fetchDeviceInfo();
        }, this.pollingIntervalMs);
    }

    private stopPolling(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    /**
     * One tick. Battery is read every time; the immutable props are read once per
     * device and network/storage only when their slower tier is due.
     */
    async fetchDeviceInfo(force = false): Promise<void> {
        const deviceId = this.deviceId;
        if (!deviceId) {
            return;
        }

        try {
            const cachedSlowTier = this.slowTier;
            const slowTierDue =
                force || cachedSlowTier === null || Date.now() - this.slowTierAt >= SLOW_TIER_MS;

            const [battery, staticInfo, freshSlowTier] = await Promise.all([
                this.getBatteryInfo(),
                this.getStaticInfo(),
                slowTierDue ? this.fetchSlowTier() : Promise.resolve(null),
            ]);

            if (this.deviceId !== deviceId) {
                // Device changed while the tick was in flight; its results are stale.
                return;
            }

            const slowTier = freshSlowTier ?? cachedSlowTier;
            if (!slowTier) {
                return;
            }
            if (freshSlowTier) {
                this.slowTier = freshSlowTier;
                this.slowTierAt = Date.now();
            }

            const deviceInfo: DeviceInfo = {
                id: deviceId,
                model: staticInfo.model,
                androidVersion: staticInfo.androidVersion,
                sdkVersion: staticInfo.sdkVersion,
                battery,
                network: slowTier.network,
                storage: slowTier.storage,
            };

            this.events.onDeviceInfo(deviceInfo);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to fetch device info: ${errorMessage}`);
        }
    }

    private async fetchSlowTier(): Promise<{
        network: DeviceInfo['network'];
        storage: DeviceInfo['storage'];
    }> {
        const [network, storage] = await Promise.all([
            this.getNetworkInfo(),
            this.getStorageInfo(),
        ]);
        return { network, storage };
    }

    private runAdbCommand(args: string[], timeoutMs: number): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.deviceId) {
                reject(new Error('No device selected'));
                return;
            }

            const adb = spawn(AdbPathResolver.getAdbCommand(), ['-s', this.deviceId, ...args], {
                windowsHide: true,
            });

            // dumpsys wifi/connectivity output is large; concatenate chunks once.
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                adb.kill();
                reject(new Error(`ADB command timed out after ${timeoutMs}ms: ${args.join(' ')}`));
            }, timeoutMs);

            const finish = (fn: () => void) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                fn();
            };

            adb.stdout.on('data', (data: Buffer) => stdoutChunks.push(data));
            adb.stderr.on('data', (data: Buffer) => stderrChunks.push(data));

            adb.on('close', (code) => {
                finish(() => {
                    if (code === 0) {
                        resolve(Buffer.concat(stdoutChunks).toString('utf8').trim());
                    } else {
                        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
                        reject(new Error(stderr || `Command failed with code ${code}`));
                    }
                });
            });

            adb.on('error', (err) => {
                finish(() => reject(new Error(`ADB command error: ${err.message}`)));
            });
        });
    }

    private async getBatteryInfo(): Promise<DeviceInfo['battery']> {
        try {
            const output = await this.runAdbCommand(
                ['shell', 'dumpsys', 'battery'],
                DUMPSYS_TIMEOUT_MS
            );

            let level = 0;
            let isCharging = false;
            let temperature: number | undefined;

            // Parse battery dump output
            const levelMatch = output.match(/level:\s*(\d+)/);
            if (levelMatch) {
                level = parseInt(levelMatch[1], 10);
            }

            const statusMatch = output.match(/status:\s*(\d+)/);
            if (statusMatch) {
                // Status 2 = charging, 5 = full
                const status = parseInt(statusMatch[1], 10);
                isCharging = status === 2 || status === 5;
            }

            const tempMatch = output.match(/temperature:\s*(\d+)/);
            if (tempMatch) {
                // Temperature is in tenths of a degree Celsius
                temperature = parseInt(tempMatch[1], 10) / 10;
            }

            return { level, isCharging, temperature };
        } catch (error) {
            console.warn('Failed to get battery info:', error);
            return { level: 0, isCharging: false };
        }
    }

    /**
     * Model, release and SDK cannot change for a given device id, so they are read
     * once - in a single shell invocation rather than three - and cached until the
     * device changes. A failed read is not cached, so it retries on the next tick.
     */
    private async getStaticInfo(): Promise<StaticDeviceInfo> {
        if (this.staticInfo) {
            return this.staticInfo;
        }
        if (this.staticInfoInFlight) {
            return this.staticInfoInFlight;
        }

        const fetch = this.readStaticInfo()
            .then((info) => {
                this.staticInfo = info;
                return info;
            })
            .catch((error) => {
                console.warn('Failed to get static device info:', error);
                return { model: 'Unknown Device', androidVersion: 'Unknown', sdkVersion: 0 };
            })
            .finally(() => {
                if (this.staticInfoInFlight === fetch) {
                    this.staticInfoInFlight = null;
                }
            });

        this.staticInfoInFlight = fetch;
        return fetch;
    }

    private async readStaticInfo(): Promise<StaticDeviceInfo> {
        const output = await this.runAdbCommand(
            [
                'shell',
                'getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk',
            ],
            GETPROP_TIMEOUT_MS
        );

        const [model = '', release = '', sdk = ''] = output.split('\n').map((line) => line.trim());
        const sdkVersion = parseInt(sdk, 10);

        return {
            model: model || 'Unknown Device',
            androidVersion: release || 'Unknown',
            sdkVersion: isNaN(sdkVersion) ? 0 : sdkVersion,
        };
    }

    private async getNetworkInfo(): Promise<DeviceInfo['network']> {
        try {
            // Check WiFi status
            const wifiOutput = await this.runAdbCommand(
                ['shell', 'dumpsys', 'wifi'],
                DUMPSYS_TIMEOUT_MS
            ).catch(() => '');

            let connected = false;
            let type: 'wifi' | 'cellular' | 'ethernet' | 'none' = 'none';
            let signalStrength: number | undefined;

            // Check if WiFi is enabled and connected
            if (wifiOutput.includes('Wi-Fi is enabled')) {
                const connectedMatch = wifiOutput.match(/mWifiInfo.*?SSID:\s*"([^"]+)"/);
                if (connectedMatch) {
                    connected = true;
                    type = 'wifi';

                    // Try to get signal strength (RSSI)
                    const rssiMatch = wifiOutput.match(/RSSI:\s*(-?\d+)/);
                    if (rssiMatch) {
                        const rssi = parseInt(rssiMatch[1], 10);
                        // Convert RSSI to percentage (rough approximation: -100 to -50 dBm)
                        signalStrength = Math.max(0, Math.min(100, ((rssi + 100) / 50) * 100));
                    }
                }
            }

            // Fallback: check connectivity service
            if (!connected) {
                try {
                    const connectivityOutput = await this.runAdbCommand(
                        ['shell', 'dumpsys', 'connectivity'],
                        DUMPSYS_TIMEOUT_MS
                    );
                    if (connectivityOutput.includes('CONNECTED')) {
                        connected = true;
                        // Try to determine type from connectivity output
                        if (connectivityOutput.includes('TYPE_WIFI')) {
                            type = 'wifi';
                        } else if (connectivityOutput.includes('TYPE_MOBILE')) {
                            type = 'cellular';
                        } else if (connectivityOutput.includes('TYPE_ETHERNET')) {
                            type = 'ethernet';
                        }
                    }
                } catch (error) {
                    // Ignore connectivity check errors
                }
            }

            return { connected, type, signalStrength };
        } catch (error) {
            console.warn('Failed to get network info:', error);
            return { connected: false, type: 'none' };
        }
    }

    private async getStorageInfo(): Promise<DeviceInfo['storage']> {
        try {
            const output = await this.runAdbCommand(['shell', 'df', '/data'], DUMPSYS_TIMEOUT_MS);

            // Parse df output: Filesystem 1K-blocks Used Available Use% Mounted on
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.includes('/data')) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 4) {
                        const total = parseInt(parts[1], 10) * 1024; // Convert from KB to bytes
                        const used = parseInt(parts[2], 10) * 1024;
                        const available = parseInt(parts[3], 10) * 1024;

                        if (!isNaN(total) && !isNaN(used) && !isNaN(available)) {
                            return { total, used, available };
                        }
                    }
                }
            }

            return { total: 0, used: 0, available: 0 };
        } catch (error) {
            console.warn('Failed to get storage info:', error);
            return { total: 0, used: 0, available: 0 };
        }
    }

    dispose(): void {
        this.stopPolling();
        this.deviceId = null;
        this.clearCaches();
    }
}
