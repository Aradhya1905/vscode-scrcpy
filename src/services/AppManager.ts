import { spawn } from 'child_process';
import { AdbPathResolver } from './AdbPathResolver';

export interface AppInfo {
    packageName: string;
    label: string;
    icon?: string; // Base64 or path
    isDebug: boolean;
    lastUsed?: Date;
}

export interface AppManagerEvents {
    onAppList: (apps: AppInfo[]) => void;
    onRecentApps: (apps: AppInfo[]) => void;
    onDebugApps: (apps: AppInfo[]) => void;
    onError: (error: string) => void;
}

export class AppManager {
    private deviceId: string | null = null;
    private events: AppManagerEvents;
    private appCache: Map<string, AppInfo> = new Map();
    private recentAppsCache: AppInfo[] = [];
    private debugAppsCache: AppInfo[] = [];

    constructor(events: AppManagerEvents) {
        this.events = events;
    }

    setDevice(deviceId: string | null): void {
        this.deviceId = deviceId;
        if (!deviceId) {
            this.appCache.clear();
            this.recentAppsCache = [];
            this.debugAppsCache = [];
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

    async getInstalledApps(): Promise<AppInfo[]> {
        if (!this.deviceId) {
            throw new Error('No device selected');
        }

        try {
            // Get all packages (including system apps)
            const packagesOutput = await this.runAdbCommand(['shell', 'pm', 'list', 'packages']);
            const packageNames = packagesOutput
                .split('\n')
                .map((line) => line.replace('package:', '').trim())
                .filter((pkg) => pkg.length > 0);

            // Get app labels in batches to avoid timeout
            const apps: AppInfo[] = [];
            const batchSize = 20;

            for (let i = 0; i < packageNames.length; i += batchSize) {
                const batch = packageNames.slice(i, i + batchSize);
                const batchPromises = batch.map((pkg) => this.getAppInfo(pkg));
                const batchApps = await Promise.all(batchPromises);
                apps.push(...(batchApps.filter((app) => app !== null) as AppInfo[]));
            }

            // Cache apps
            apps.forEach((app) => this.appCache.set(app.packageName, app));

            this.events.onAppList(apps);
            return apps;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to get installed apps: ${errorMessage}`);
            throw error;
        }
    }

    async getRecentApps(): Promise<AppInfo[]> {
        if (!this.deviceId) {
            throw new Error('No device selected');
        }

        try {
            // Try to get recent apps from dumpsys recents
            let recentPackages: string[] = [];

            try {
                const recentsOutput = await this.runAdbCommand(['shell', 'dumpsys', 'recents']);
                // Parse recent tasks from output
                const taskMatches = recentsOutput.match(/Recent #\d+.*?package=([^\s]+)/g);
                if (taskMatches) {
                    recentPackages = taskMatches
                        .map((match) => {
                            const pkgMatch = match.match(/package=([^\s]+)/);
                            return pkgMatch ? pkgMatch[1] : null;
                        })
                        .filter((pkg): pkg is string => pkg !== null)
                        .filter((pkg, index, self) => self.indexOf(pkg) === index); // Remove duplicates
                }
            } catch (error) {
                console.warn('Failed to get recent apps from recents, trying activities:', error);
            }

            // Fallback: try dumpsys activity activities
            if (recentPackages.length === 0) {
                try {
                    const activitiesOutput = await this.runAdbCommand([
                        'shell',
                        'dumpsys',
                        'activity',
                        'activities',
                    ]);
                    // Look for resumed activities
                    const resumedMatches = activitiesOutput.match(
                        /mResumedActivity.*?package=([^\s]+)/g
                    );
                    if (resumedMatches) {
                        recentPackages = resumedMatches
                            .map((match) => {
                                const pkgMatch = match.match(/package=([^\s]+)/);
                                return pkgMatch ? pkgMatch[1] : null;
                            })
                            .filter((pkg): pkg is string => pkg !== null)
                            .filter((pkg, index, self) => self.indexOf(pkg) === index);
                    }
                } catch (error) {
                    console.warn('Failed to get recent apps from activities:', error);
                }
            }

            // Get app info for recent packages
            const recentApps: AppInfo[] = [];
            for (const pkg of recentPackages.slice(0, 15)) {
                // Limit to 15 most recent
                let app = this.appCache.get(pkg);
                if (!app) {
                    const appInfo = await this.getAppInfo(pkg);
                    if (appInfo) {
                        app = appInfo;
                        this.appCache.set(pkg, app);
                    }
                }
                if (app) {
                    recentApps.push(app);
                }
            }

            this.recentAppsCache = recentApps;
            this.events.onRecentApps(recentApps);
            return recentApps;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to get recent apps: ${errorMessage}`);
            throw error;
        }
    }

    async getDebugApps(): Promise<AppInfo[]> {
        if (!this.deviceId) {
            throw new Error('No device selected');
        }

        try {
            // Get all packages first
            const packagesOutput = await this.runAdbCommand(['shell', 'pm', 'list', 'packages']);
            const packageNames = packagesOutput
                .split('\n')
                .map((line) => line.replace('package:', '').trim())
                .filter((pkg) => pkg.length > 0);

            // Check each package for debuggable flag
            const debugApps: AppInfo[] = [];
            const batchSize = 10;

            for (let i = 0; i < packageNames.length; i += batchSize) {
                const batch = packageNames.slice(i, i + batchSize);
                const batchPromises = batch.map(async (pkg) => {
                    try {
                        const dumpOutput = await this.runAdbCommand([
                            'shell',
                            'dumpsys',
                            'package',
                            pkg,
                        ]);
                        const isDebug =
                            dumpOutput.includes('flags=0x') &&
                            (dumpOutput.match(/flags=0x[\da-f]+\s+DEBUGGABLE/g) !== null ||
                                dumpOutput.includes('DEBUGGABLE'));

                        if (isDebug) {
                            let app = this.appCache.get(pkg);
                            if (!app) {
                                const appInfo = await this.getAppInfo(pkg);
                                if (appInfo) {
                                    app = appInfo;
                                    this.appCache.set(pkg, app);
                                }
                            }
                            if (app) {
                                app.isDebug = true;
                                return app;
                            }
                        }
                        return null;
                    } catch (error) {
                        // Skip packages that fail to check
                        return null;
                    }
                });

                const batchResults = await Promise.all(batchPromises);
                debugApps.push(...batchResults.filter((app): app is AppInfo => app !== null));
            }

            this.debugAppsCache = debugApps;
            this.events.onDebugApps(debugApps);
            return debugApps;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to get debug apps: ${errorMessage}`);
            throw error;
        }
    }

    async launchApp(packageName: string): Promise<void> {
        if (!this.deviceId) {
            throw new Error('No device selected');
        }

        try {
            // Use monkey to launch app
            await this.runAdbCommand([
                'shell',
                'monkey',
                '-p',
                packageName,
                '-c',
                'android.intent.category.LAUNCHER',
                '1',
            ]);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to launch app ${packageName}: ${errorMessage}`);
            throw error;
        }
    }

    private async getAppInfo(packageName: string): Promise<AppInfo | null> {
        try {
            // Get app label from dumpsys package
            const dumpOutput = await this.runAdbCommand([
                'shell',
                'dumpsys',
                'package',
                packageName,
            ]);

            // Extract label from ApplicationInfo section
            let label = packageName; // Default to package name
            const labelMatch = dumpOutput.match(/applicationLabel=([^\n]+)/);
            if (labelMatch) {
                label = labelMatch[1].trim();
            } else {
                // Try alternative format
                const altLabelMatch = dumpOutput.match(/Application Label:\s*([^\n]+)/);
                if (altLabelMatch) {
                    label = altLabelMatch[1].trim();
                }
            }

            // Check if debuggable
            const isDebug =
                dumpOutput.includes('flags=0x') &&
                (dumpOutput.match(/flags=0x[\da-f]+\s+DEBUGGABLE/g) !== null ||
                    dumpOutput.includes('DEBUGGABLE'));

            return {
                packageName,
                label: label || packageName,
                isDebug,
            };
        } catch (error) {
            // If we can't get info, return basic info
            console.warn(`Failed to get app info for ${packageName}:`, error);
            return {
                packageName,
                label: packageName,
                isDebug: false,
            };
        }
    }

    dispose(): void {
        this.deviceId = null;
        this.appCache.clear();
        this.recentAppsCache = [];
        this.debugAppsCache = [];
    }
}
