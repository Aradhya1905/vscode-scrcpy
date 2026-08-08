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

/** ApplicationInfo.FLAG_DEBUGGABLE, for devices that print flags in hex. */
const FLAG_DEBUGGABLE = 0x00000002;

/** How long a package index stays usable before the next request re-scans. */
const PACKAGE_INDEX_TTL_MS = 30_000;

/** Recents change constantly; this TTL only collapses duplicate bursts. */
const RECENT_APPS_TTL_MS = 3_000;

const RECENT_APPS_LIMIT = 15;

const PM_LIST_TIMEOUT_MS = 15_000;
const DUMPSYS_TIMEOUT_MS = 30_000;

export class AppManager {
    private deviceId: string | null = null;
    private events: AppManagerEvents;

    /** packageName -> AppInfo, built from one bulk dump. Never handed out directly. */
    private appCache: Map<string, AppInfo> = new Map();
    private appCacheAt = 0;
    /** Shared promise so concurrent list/debug requests fund a single scan. */
    private appCacheInFlight: Promise<Map<string, AppInfo>> | null = null;

    private recentAppsCache: AppInfo[] = [];
    private recentAppsCacheAt = 0;
    private recentAppsInFlight: Promise<AppInfo[]> | null = null;

    private debugAppsCache: AppInfo[] = [];
    private debugAppsCacheAt = 0;

    constructor(events: AppManagerEvents) {
        this.events = events;
    }

    setDevice(deviceId: string | null): void {
        if (deviceId === this.deviceId) {
            return;
        }
        this.deviceId = deviceId;
        // Caches are per device, so any change invalidates them - not just a disconnect.
        this.clearCaches();
    }

    private clearCaches(): void {
        this.appCache.clear();
        this.appCacheAt = 0;
        this.appCacheInFlight = null;
        this.recentAppsCache = [];
        this.recentAppsCacheAt = 0;
        this.recentAppsInFlight = null;
        this.debugAppsCache = [];
        this.debugAppsCacheAt = 0;
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

            // Full package dumps run to several MB; collecting chunks and
            // concatenating once avoids the quadratic cost of string +=.
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

    /**
     * Builds packageName -> AppInfo from exactly two ADB invocations, regardless
     * of how many packages the device has installed.
     */
    private async ensurePackageIndex(force: boolean): Promise<Map<string, AppInfo>> {
        if (!this.deviceId) {
            throw new Error('No device selected');
        }

        const isFresh =
            this.appCache.size > 0 && Date.now() - this.appCacheAt < PACKAGE_INDEX_TTL_MS;
        if (!force && isFresh) {
            return this.appCache;
        }

        // An in-flight scan is already fetching current data, so a forced refresh
        // joins it rather than starting a second full dump.
        if (this.appCacheInFlight) {
            return this.appCacheInFlight;
        }

        const scan = this.scanPackages()
            .then((index) => {
                this.appCache = index;
                this.appCacheAt = Date.now();
                return index;
            })
            .finally(() => {
                if (this.appCacheInFlight === scan) {
                    this.appCacheInFlight = null;
                }
            });

        this.appCacheInFlight = scan;
        return scan;
    }

    private async scanPackages(): Promise<Map<string, AppInfo>> {
        const [packagesOutput, dumpOutput] = await Promise.all([
            this.runAdbCommand(['shell', 'pm', 'list', 'packages'], PM_LIST_TIMEOUT_MS),
            // One dump for every package. Failing here only costs labels and the
            // debuggable flag, so degrade instead of falling back to per-package dumps.
            this.runAdbCommand(
                ['shell', 'dumpsys', 'package', 'packages'],
                DUMPSYS_TIMEOUT_MS
            ).catch(() => ''),
        ]);

        const packageNames = packagesOutput
            .split('\n')
            .map((line) => line.replace('package:', '').trim())
            .filter((pkg) => pkg.length > 0);

        const details = dumpOutput ? this.parsePackageDump(dumpOutput) : new Map<string, AppInfo>();

        const index = new Map<string, AppInfo>();
        for (const packageName of packageNames) {
            const detail = details.get(packageName);
            index.set(packageName, {
                packageName,
                label: detail?.label || packageName,
                isDebug: detail?.isDebug ?? false,
            });
        }
        return index;
    }

    /**
     * Single pass over `dumpsys package packages`. Blocks look like:
     *
     *   Package [com.example] (a1b2c3):
     *     userId=10123
     *     pkgFlags=[ DEBUGGABLE HAS_CODE ]
     */
    private parsePackageDump(dumpOutput: string): Map<string, AppInfo> {
        const details = new Map<string, AppInfo>();
        let currentPackage: string | null = null;

        for (const rawLine of dumpOutput.split('\n')) {
            const line = rawLine.trim();

            const header = line.match(/^Package \[([^\]]+)\]/);
            if (header) {
                currentPackage = header[1];
                // "Hidden system packages:" repeats entries already seen; first wins.
                if (!details.has(currentPackage)) {
                    details.set(currentPackage, {
                        packageName: currentPackage,
                        label: currentPackage,
                        isDebug: false,
                    });
                }
                continue;
            }

            if (!currentPackage) {
                continue;
            }
            const detail = details.get(currentPackage);
            if (!detail) {
                continue;
            }

            const labelMatch = line.match(/^applicationLabel=(.+)$/);
            if (labelMatch) {
                const label = labelMatch[1].trim();
                if (label) {
                    detail.label = label;
                }
                continue;
            }

            if (!detail.isDebug && this.isDebuggableFlagLine(line)) {
                detail.isDebug = true;
            }
        }

        return details;
    }

    private isDebuggableFlagLine(line: string): boolean {
        // Modern: flags=[ DEBUGGABLE HAS_CODE ]  /  pkgFlags=[ ... ]
        const bracketMatch = line.match(/^(?:pkg)?[Ff]lags=\[([^\]]*)\]/);
        if (bracketMatch) {
            return /\bDEBUGGABLE\b/.test(bracketMatch[1]);
        }

        // Legacy: flags=0x38c1be44
        const hexMatch = line.match(/^(?:pkg)?[Ff]lags=0x([\da-fA-F]+)/);
        if (hexMatch) {
            return (parseInt(hexMatch[1], 16) & FLAG_DEBUGGABLE) !== 0;
        }

        return false;
    }

    async getInstalledApps(force = false): Promise<AppInfo[]> {
        if (!this.deviceId) {
            throw new Error('No device selected');
        }

        try {
            const index = await this.ensurePackageIndex(force);
            const apps = [...index.values()]
                .map((app) => ({ ...app }))
                .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

            this.events.onAppList(apps);
            return apps;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to get installed apps: ${errorMessage}`);
            throw error;
        }
    }

    async getDebugApps(force = false): Promise<AppInfo[]> {
        if (!this.deviceId) {
            throw new Error('No device selected');
        }

        if (
            !force &&
            this.debugAppsCacheAt > 0 &&
            Date.now() - this.debugAppsCacheAt < PACKAGE_INDEX_TTL_MS
        ) {
            this.events.onDebugApps(this.debugAppsCache);
            return this.debugAppsCache;
        }

        try {
            const index = await this.ensurePackageIndex(force);
            const debugApps = [...index.values()]
                .filter((app) => app.isDebug)
                .map((app) => ({ ...app }))
                .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

            this.debugAppsCache = debugApps;
            this.debugAppsCacheAt = Date.now();
            this.events.onDebugApps(debugApps);
            return debugApps;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to get debug apps: ${errorMessage}`);
            throw error;
        }
    }

    async getRecentApps(force = false): Promise<AppInfo[]> {
        if (!this.deviceId) {
            throw new Error('No device selected');
        }

        if (
            !force &&
            this.recentAppsCacheAt > 0 &&
            Date.now() - this.recentAppsCacheAt < RECENT_APPS_TTL_MS
        ) {
            this.events.onRecentApps(this.recentAppsCache);
            return this.recentAppsCache;
        }

        if (this.recentAppsInFlight) {
            return this.recentAppsInFlight;
        }

        const load = this.loadRecentApps()
            .then((apps) => {
                this.recentAppsCache = apps;
                this.recentAppsCacheAt = Date.now();
                this.events.onRecentApps(apps);
                return apps;
            })
            .catch((error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.events.onError(`Failed to get recent apps: ${errorMessage}`);
                throw error;
            })
            .finally(() => {
                if (this.recentAppsInFlight === load) {
                    this.recentAppsInFlight = null;
                }
            });

        this.recentAppsInFlight = load;
        return load;
    }

    private async loadRecentApps(): Promise<AppInfo[]> {
        let recentPackages = await this.readRecentPackages([
            'shell',
            'dumpsys',
            'activity',
            'recents',
        ]);

        if (recentPackages.length === 0) {
            recentPackages = await this.readRecentPackages([
                'shell',
                'dumpsys',
                'activity',
                'activities',
            ]);
        }

        // Labels and flags come from the index only if it is already warm - a
        // recents refresh must never trigger a full package scan.
        const index = this.appCache.size > 0 ? this.appCache : null;

        return recentPackages.slice(0, RECENT_APPS_LIMIT).map((packageName) => {
            const known = index?.get(packageName);
            return {
                packageName,
                label: known?.label || packageName,
                isDebug: known?.isDebug ?? false,
            };
        });
    }

    /** Extracts package names in recency order from an activity dump. */
    private async readRecentPackages(args: string[]): Promise<string[]> {
        let output: string;
        try {
            output = await this.runAdbCommand(args, DUMPSYS_TIMEOUT_MS);
        } catch {
            return [];
        }

        const ordered: string[] = [];
        const seen = new Set<string>();
        const push = (packageName: string | undefined) => {
            if (!packageName || seen.has(packageName) || !packageName.includes('.')) {
                return;
            }
            seen.add(packageName);
            ordered.push(packageName);
        };

        for (const line of output.split('\n')) {
            // Recent #0: Task{... A=10123:com.example.app ...}
            push(line.match(/\bA=\d+:([a-zA-Z][\w.]*)/)?.[1]);
            // realActivity=com.example.app/.MainActivity
            push(line.match(/\brealActivity=([a-zA-Z][\w.]*)\//)?.[1]);
            // baseIntent=Intent { ... cmp=com.example.app/.MainActivity }
            push(line.match(/\bcmp=([a-zA-Z][\w.]*)\//)?.[1]);
            // mResumedActivity: ActivityRecord{... u0 com.example.app/.MainActivity t42}
            push(line.match(/ResumedActivity[^\n]*\bu\d+\s+([a-zA-Z][\w.]*)\//)?.[1]);
        }

        return ordered;
    }

    async launchApp(packageName: string): Promise<void> {
        if (!this.deviceId) {
            throw new Error('No device selected');
        }

        try {
            // Use monkey to launch app
            await this.runAdbCommand(
                [
                    'shell',
                    'monkey',
                    '-p',
                    packageName,
                    '-c',
                    'android.intent.category.LAUNCHER',
                    '1',
                ],
                PM_LIST_TIMEOUT_MS
            );
            // The launched app is now the most recent one.
            this.recentAppsCacheAt = 0;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.events.onError(`Failed to launch app ${packageName}: ${errorMessage}`);
            throw error;
        }
    }

    dispose(): void {
        this.deviceId = null;
        this.clearCaches();
    }
}
