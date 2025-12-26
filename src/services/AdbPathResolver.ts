import { spawn } from 'child_process';

/**
 * Cross-platform ADB path resolver.
 * Simply uses 'adb' from system PATH - users who need ADB features
 * should have ADB installed and configured in their PATH.
 */
export class AdbPathResolver {
    private static _isAvailable: boolean | null = null;
    private static _adbVersion: string | null = null;

    /**
     * Get the ADB command to use.
     * Returns 'adb' to use from system PATH.
     */
    static getAdbCommand(): string {
        return 'adb';
    }

    /**
     * Check if ADB is available in PATH.
     * Caches the result after first check.
     */
    static async isAdbAvailable(): Promise<boolean> {
        if (this._isAvailable !== null) {
            return this._isAvailable;
        }

        try {
            const version = await this._checkAdbVersion();
            this._isAvailable = version !== null;
            this._adbVersion = version;
            return this._isAvailable;
        } catch {
            this._isAvailable = false;
            return false;
        }
    }

    /**
     * Get ADB version string if available.
     */
    static async getAdbVersion(): Promise<string | null> {
        if (this._adbVersion !== null) {
            return this._adbVersion;
        }
        await this.isAdbAvailable();
        return this._adbVersion;
    }

    /**
     * Reset the cached availability status.
     * Useful when user might have installed ADB after initial check.
     */
    static resetCache(): void {
        this._isAvailable = null;
        this._adbVersion = null;
    }

    /**
     * Run 'adb version' to check if ADB is available.
     */
    private static _checkAdbVersion(): Promise<string | null> {
        return new Promise((resolve) => {
            const adb = spawn('adb', ['version'], {
                windowsHide: true,
                shell: process.platform === 'win32', // Use shell on Windows to find adb in PATH
            });
            let output = '';
            let resolved = false;

            const finish = (value: string | null) => {
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
                finish(null);
            }, 5000);

            adb.stdout.on('data', (data) => {
                output += data.toString();
            });

            adb.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0 && output) {
                    // Extract version from output like "Android Debug Bridge version 1.0.41"
                    const match = output.match(/Android Debug Bridge version ([\d.]+)/);
                    finish(match ? match[1] : output.split('\n')[0]);
                } else {
                    finish(null);
                }
            });

            adb.on('error', () => {
                clearTimeout(timer);
                finish(null);
            });
        });
    }
}
