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

export class DeviceInfoService {
    private deviceId: string | null = null;
    private pollingInterval: NodeJS.Timeout | null = null;
    private events: DeviceInfoServiceEvents;
    private pollingIntervalMs: number;

    constructor(events: DeviceInfoServiceEvents, pollingIntervalMs: number = 5000) {
        this.events = events;
        this.pollingIntervalMs = pollingIntervalMs;
    }

    setDevice(deviceId: string | null): void {
        this.deviceId = deviceId;
        if (deviceId) {
            this.startPolling();
        } else {
            this.stopPolling();
        }
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

    async fetchDeviceInfo(): Promise<void> {
        if (!this.deviceId) {
            return;
        }

        try {
            const [battery, model, androidVersion, sdkVersion, network, storage] =
                await Promise.all([
                    this.getBatteryInfo(),
                    this.getDeviceModel(),
                    this.getAndroidVersion(),
                    this.getSdkVersion(),
                    this.getNetworkInfo(),
                    this.getStorageInfo(),
                ]);

            const deviceInfo: DeviceInfo = {
                id: this.deviceId,
                model: model || 'Unknown Device',
                androidVersion: androidVersion || 'Unknown',
                sdkVersion: sdkVersion || 0,
                battery,
                network,
                storage,
            };

            this.events.onDeviceInfo(deviceInfo);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to fetch device info: ${errorMessage}`);
        }
    }

    private runAdbCommand(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.deviceId) {
                reject(new Error('No device selected'));
                return;
            }

            const adb = spawn(AdbPathResolver.getAdbCommand(), ['-s', this.deviceId, ...args], {
                windowsHide: true,
            });
            let output = '';
            let stderr = '';

            adb.stdout.on('data', (data) => {
                output += data.toString();
            });

            adb.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            adb.on('close', (code) => {
                if (code === 0) {
                    resolve(output.trim());
                } else {
                    reject(new Error(stderr || `Command failed with code ${code}`));
                }
            });

            adb.on('error', (err) => {
                reject(new Error(`ADB command error: ${err.message}`));
            });
        });
    }

    private async getBatteryInfo(): Promise<DeviceInfo['battery']> {
        try {
            const output = await this.runAdbCommand(['shell', 'dumpsys', 'battery']);

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

    private async getDeviceModel(): Promise<string> {
        try {
            const output = await this.runAdbCommand(['shell', 'getprop', 'ro.product.model']);
            return output.trim() || 'Unknown Device';
        } catch (error) {
            console.warn('Failed to get device model:', error);
            return 'Unknown Device';
        }
    }

    private async getAndroidVersion(): Promise<string> {
        try {
            const output = await this.runAdbCommand([
                'shell',
                'getprop',
                'ro.build.version.release',
            ]);
            return output.trim() || 'Unknown';
        } catch (error) {
            console.warn('Failed to get Android version:', error);
            return 'Unknown';
        }
    }

    private async getSdkVersion(): Promise<number> {
        try {
            const output = await this.runAdbCommand(['shell', 'getprop', 'ro.build.version.sdk']);
            const sdk = parseInt(output.trim(), 10);
            return isNaN(sdk) ? 0 : sdk;
        } catch (error) {
            console.warn('Failed to get SDK version:', error);
            return 0;
        }
    }

    private async getNetworkInfo(): Promise<DeviceInfo['network']> {
        try {
            // Check WiFi status
            const wifiOutput = await this.runAdbCommand(['shell', 'dumpsys', 'wifi']).catch(
                () => ''
            );

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
                    const connectivityOutput = await this.runAdbCommand([
                        'shell',
                        'dumpsys',
                        'connectivity',
                    ]);
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
            const output = await this.runAdbCommand(['shell', 'df', '/data']);

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
    }
}
