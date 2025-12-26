import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { AdbPathResolver } from './AdbPathResolver';

export type LogcatLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';

export interface LogcatEntry {
    id: string;
    timestamp: Date;
    level: LogcatLevel;
    tag: string;
    pid: number;
    tid: number;
    message: string;
    raw: string;
    groupId?: string; // Used to group related entries (e.g., stack traces)
    isGroupStart?: boolean; // First entry in a group
    isStackTrace?: boolean; // This entry is part of a stack trace
}

export interface CrashLog {
    id: string;
    timestamp: Date;
    packageName: string;
    pid: number;
    exceptionType: string;
    exceptionMessage: string;
    stackTrace: string[];
    rawLog: string;
}

export interface AppProcess {
    packageName: string;
    appName?: string;
    pid: number;
    isRunning: boolean;
}

export class AdbLogcatService {
    private logcatProcess: ChildProcess | null = null;
    private onLogEntryCallback: ((entry: LogcatEntry) => void) | null = null;
    private onCrashCallback: ((crash: CrashLog) => void) | null = null;
    private onErrorCallback: ((error: string) => void) | null = null;

    private logIdCounter = 0;
    private crashIdCounter = 0;
    private currentCrashBuffer: string[] = [];
    private isCollectingCrash = false;

    private pidToPackage: Map<number, string> = new Map();
    private targetPackage: string | null = null;

    // Pause and throttling state
    private isPaused = false;
    private pendingLogs: LogcatEntry[] = [];
    private throttleTimer: NodeJS.Timeout | null = null;
    private readonly THROTTLE_INTERVAL_MS = 100;
    private readonly MAX_BATCH_SIZE = 50;

    // Line buffer for handling partial lines from stream
    private lineBuffer = '';

    // Grouping state for stack traces
    private groupIdCounter = 0;
    private currentGroupId: string | null = null;
    private lastEntryForGrouping: {
        timestamp: number;
        pid: number;
        tid: number;
        tag: string;
        level: LogcatLevel;
    } | null = null;

    constructor(private context: vscode.ExtensionContext) {
        // context reserved for future (settings/storage)
        void this.context;
    }

    pause(): void {
        this.isPaused = true;
    }

    resume(): void {
        this.isPaused = false;
        this.flushPendingLogs();
    }

    isPausedState(): boolean {
        return this.isPaused;
    }

    async startStreaming(
        deviceId: string,
        options?: {
            packageName?: string;
            logLevel?: LogcatLevel;
            buffers?: ('main' | 'system' | 'crash' | 'events')[];
            clear?: boolean;
        }
    ): Promise<void> {
        this.stopStreaming();

        if (options?.clear) {
            await this.clearLogs(deviceId);
        }

        const args = ['-s', deviceId, 'logcat', '-v', 'threadtime'];

        if (options?.buffers && options.buffers.length > 0) {
            for (const buffer of options.buffers) {
                args.push('-b', buffer);
            }
        }

        if (options?.logLevel) {
            args.push(`*:${options.logLevel}`);
        }

        this.targetPackage = options?.packageName || null;
        this.pidToPackage.clear();

        if (this.targetPackage) {
            await this.updatePidMapping(deviceId, this.targetPackage);
        }

        this.logcatProcess = spawn(AdbPathResolver.getAdbCommand(), args, { windowsHide: true });

        this.logcatProcess.stdout?.on('data', (data) => {
            // Append to line buffer to handle partial lines
            this.lineBuffer += data.toString();

            // Split by newlines but keep track of incomplete last line
            const lines = this.lineBuffer.split('\n');

            // Last element might be incomplete, save it for next chunk
            this.lineBuffer = lines.pop() || '';

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine) {
                    this.processLogLine(trimmedLine);
                }
            }
        });

        this.logcatProcess.stderr?.on('data', (data) => {
            const error = data.toString();
            this.onErrorCallback?.(error);
        });

        this.logcatProcess.on('close', () => {
            this.logcatProcess = null;
        });

        this.logcatProcess.on('error', (err) => {
            this.onErrorCallback?.(err.message);
        });
    }

    stopStreaming(): void {
        if (this.logcatProcess) {
            try {
                this.logcatProcess.kill();
            } catch {
                // ignore
            }
            this.logcatProcess = null;
        }
        this.currentCrashBuffer = [];
        this.isCollectingCrash = false;
        this.isPaused = false;
        this.pendingLogs = [];
        this.lineBuffer = '';
        this.currentGroupId = null;
        this.lastEntryForGrouping = null;
        if (this.throttleTimer) {
            clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
        }
    }

    private flushPendingLogs(): void {
        if (this.pendingLogs.length === 0) return;

        const logsToSend = this.pendingLogs.splice(0, this.MAX_BATCH_SIZE);
        for (const entry of logsToSend) {
            this.onLogEntryCallback?.(entry);
        }

        // If there are more pending logs, schedule another flush
        if (this.pendingLogs.length > 0 && !this.isPaused) {
            this.scheduleFlush();
        }
    }

    private scheduleFlush(): void {
        if (this.throttleTimer) return;

        this.throttleTimer = setTimeout(() => {
            this.throttleTimer = null;
            if (!this.isPaused) {
                this.flushPendingLogs();
            }
        }, this.THROTTLE_INTERVAL_MS);
    }

    private queueLogEntry(entry: LogcatEntry): void {
        this.pendingLogs.push(entry);

        // Limit pending logs to prevent memory issues
        if (this.pendingLogs.length > 1000) {
            this.pendingLogs = this.pendingLogs.slice(-500);
        }

        if (!this.isPaused) {
            this.scheduleFlush();
        }
    }

    async clearLogs(deviceId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const adb = spawn(AdbPathResolver.getAdbCommand(), ['-s', deviceId, 'logcat', '-c'], {
                windowsHide: true,
            });

            adb.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Failed to clear logs, exit code: ${code}`));
                }
            });

            adb.on('error', (err) => reject(err));
        });
    }

    async getRunningApps(deviceId: string): Promise<AppProcess[]> {
        // Best-effort: parse `ps -A` last column as process name, keep only dotted names.
        return new Promise((resolve) => {
            const adb = spawn(
                AdbPathResolver.getAdbCommand(),
                ['-s', deviceId, 'shell', 'ps', '-A'],
                {
                    windowsHide: true,
                }
            );

            let output = '';
            adb.stdout.on('data', (data) => {
                output += data.toString();
            });

            adb.on('close', () => {
                const apps: AppProcess[] = [];
                const lines = output.trim().split('\n');
                for (const line of lines.slice(1)) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 2) continue;

                    const pid = parseInt(parts[1], 10);
                    const name = parts[parts.length - 1];
                    if (!isNaN(pid) && name && name.includes('.')) {
                        apps.push({ packageName: name, pid, isRunning: true });
                    }
                }
                resolve(apps);
            });

            adb.on('error', () => resolve([]));
        });
    }

    async getInstalledPackages(
        deviceId: string,
        thirdPartyOnly: boolean = true
    ): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const args = ['-s', deviceId, 'shell', 'pm', 'list', 'packages'];
            if (thirdPartyOnly) args.push('-3');

            const adb = spawn(AdbPathResolver.getAdbCommand(), args, { windowsHide: true });
            let output = '';

            adb.stdout.on('data', (data) => {
                output += data.toString();
            });

            adb.on('close', () => {
                const packages = output
                    .trim()
                    .split('\n')
                    .map((line) => line.replace('package:', '').trim())
                    .filter((pkg) => pkg.length > 0);

                resolve(packages);
            });

            adb.on('error', (err) => reject(err));
        });
    }

    private async updatePidMapping(deviceId: string, packageName: string): Promise<void> {
        // Prefer pidof when available; fallback to ps parsing.
        const pids = await this.tryPidof(deviceId, packageName);
        if (pids.length > 0) {
            for (const pid of pids) {
                this.pidToPackage.set(pid, packageName);
            }
            return;
        }

        await new Promise<void>((resolve) => {
            const adb = spawn(
                AdbPathResolver.getAdbCommand(),
                ['-s', deviceId, 'shell', 'ps', '-A'],
                {
                    windowsHide: true,
                }
            );

            let output = '';
            adb.stdout.on('data', (data) => {
                output += data.toString();
            });

            adb.on('close', () => {
                const lines = output.trim().split('\n');
                for (const line of lines.slice(1)) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 2) continue;
                    const pid = parseInt(parts[1], 10);
                    const name = parts[parts.length - 1];
                    if (!isNaN(pid) && name && name.includes(packageName)) {
                        this.pidToPackage.set(pid, name);
                    }
                }
                resolve();
            });

            adb.on('error', () => resolve());
        });
    }

    private tryPidof(deviceId: string, packageName: string): Promise<number[]> {
        return new Promise((resolve) => {
            const adb = spawn(
                AdbPathResolver.getAdbCommand(),
                ['-s', deviceId, 'shell', 'pidof', packageName],
                {
                    windowsHide: true,
                }
            );

            let output = '';
            adb.stdout.on('data', (data) => {
                output += data.toString();
            });

            adb.on('close', () => {
                const raw = output.trim();
                if (!raw) return resolve([]);

                const pids = raw
                    .split(/\s+/)
                    .map((s) => parseInt(s, 10))
                    .filter((n) => !isNaN(n));
                resolve(pids);
            });

            adb.on('error', () => resolve([]));
        });
    }

    private processLogLine(line: string): void {
        const entry = this.parseLogLine(line);
        if (!entry) {
            return;
        }

        if (this.targetPackage) {
            const entryPackage = this.pidToPackage.get(entry.pid);
            if (!entryPackage || !entryPackage.includes(this.targetPackage)) {
                // Weak heuristic: sometimes tags include package name.
                if (
                    entry.tag.includes(this.targetPackage) ||
                    entry.message.includes(this.targetPackage)
                ) {
                    this.pidToPackage.set(entry.pid, this.targetPackage);
                } else {
                    return;
                }
            }
        }

        if (this.isCrashStart(entry)) {
            this.isCollectingCrash = true;
            this.currentCrashBuffer = [line];
        } else if (this.isCollectingCrash) {
            this.currentCrashBuffer.push(line);
            if (this.isCrashEnd(entry)) {
                this.processCrashBuffer();
                this.isCollectingCrash = false;
                this.currentCrashBuffer = [];
            }
        }

        // Apply grouping for stack traces and related error entries
        this.applyGrouping(entry);

        this.queueLogEntry(entry);
    }

    /**
     * Check if a message looks like a stack trace line
     */
    private isStackTraceLine(message: string): boolean {
        const trimmed = message.trim();
        return (
            // Stack trace "at" lines (with or without leading whitespace/tab)
            /^\s*at\s+[\w.$]+/.test(message) ||
            trimmed.startsWith('\tat ') ||
            // Caused by lines
            trimmed.startsWith('Caused by:') ||
            // Suppressed/more frames indicator
            /^\s*\.\.\.\s*\d+\s+more/.test(message) ||
            trimmed.startsWith('... ') ||
            // Exception class names at start of line
            /^(java|android|kotlin|javax|com\.|org\.|net\.|io\.)[\w.$]+(Exception|Error)/.test(
                trimmed
            )
        );
    }

    /**
     * Check if an entry starts a new error/exception group
     */
    private isErrorStart(entry: LogcatEntry): boolean {
        if (entry.level !== 'E' && entry.level !== 'F') return false;
        const msg = entry.message.toLowerCase();
        return (
            msg.includes('exception') ||
            msg.includes('error') ||
            msg.includes('fatal') ||
            msg.includes('crash') ||
            /^(java|android|kotlin)\.\w+/.test(entry.message)
        );
    }

    /**
     * Apply grouping to entries that belong together (stack traces, etc.)
     */
    private applyGrouping(entry: LogcatEntry): void {
        const entryTime = entry.timestamp.getTime();
        const isStackTrace = this.isStackTraceLine(entry.message);
        const isErrorEntry = entry.level === 'E' || entry.level === 'F';

        // Check if this entry should continue the current group
        const shouldContinueGroup =
            this.lastEntryForGrouping &&
            this.currentGroupId &&
            entry.pid === this.lastEntryForGrouping.pid &&
            entry.tid === this.lastEntryForGrouping.tid &&
            entry.tag === this.lastEntryForGrouping.tag &&
            entry.level === this.lastEntryForGrouping.level &&
            // Same timestamp (within 100ms tolerance for log batching)
            Math.abs(entryTime - this.lastEntryForGrouping.timestamp) < 100;

        if (shouldContinueGroup && isErrorEntry) {
            // Continue the current group
            entry.groupId = this.currentGroupId!;
            entry.isStackTrace = isStackTrace;
        } else if (isErrorEntry && (this.isErrorStart(entry) || isStackTrace)) {
            // Start a new group
            this.currentGroupId = `group-${++this.groupIdCounter}`;
            entry.groupId = this.currentGroupId;
            entry.isGroupStart = true;
            entry.isStackTrace = isStackTrace;
        } else {
            // Not part of a group, reset grouping state
            this.currentGroupId = null;
        }

        // Update last entry for next comparison
        if (isErrorEntry) {
            this.lastEntryForGrouping = {
                timestamp: entryTime,
                pid: entry.pid,
                tid: entry.tid,
                tag: entry.tag,
                level: entry.level,
            };
        } else {
            this.lastEntryForGrouping = null;
            this.currentGroupId = null;
        }
    }

    /**
     * Parse logcat line to structured entry.
     * threadtime: "MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG: MESSAGE"
     */
    private parseLogLine(line: string): LogcatEntry | null {
        // Threadtime format: MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG: MESSAGE
        // Allow flexible whitespace between fields
        const regex =
            /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+?):\s*(.*)$/;
        const match = line.match(regex);

        if (match) {
            const [, mm, dd, hh, min, ss, ms, pidStr, tidStr, level, tag, message] = match;
            const now = new Date();
            const year = now.getFullYear();
            const month = parseInt(mm, 10) - 1;
            const day = parseInt(dd, 10);

            const hour = parseInt(hh, 10);
            const minute = parseInt(min, 10);
            const sec = parseInt(ss, 10);
            const milli = parseInt(ms, 10);

            const timestamp = new Date(year, month, day, hour, minute, sec, milli);

            return {
                id: `log-${++this.logIdCounter}`,
                timestamp,
                level: level as LogcatLevel,
                tag: tag.trim(),
                pid: parseInt(pidStr, 10),
                tid: parseInt(tidStr, 10),
                message,
                raw: line,
            };
        }

        // Fallback: try simpler format without TAG: separator (some stack traces)
        const simpleRegex =
            /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.+)$/;
        const simpleMatch = line.match(simpleRegex);

        if (simpleMatch) {
            const [, mm, dd, hh, min, ss, ms, pidStr, tidStr, level, rest] = simpleMatch;
            const now = new Date();
            const year = now.getFullYear();
            const timestamp = new Date(
                year,
                parseInt(mm, 10) - 1,
                parseInt(dd, 10),
                parseInt(hh, 10),
                parseInt(min, 10),
                parseInt(ss, 10),
                parseInt(ms, 10)
            );

            // Try to split tag and message on first colon, or use whole thing as message
            const colonIdx = rest.indexOf(':');
            let tag = 'Unknown';
            let message = rest;
            if (colonIdx > 0 && colonIdx < 40) {
                tag = rest.substring(0, colonIdx).trim();
                message = rest.substring(colonIdx + 1).trim();
            }

            return {
                id: `log-${++this.logIdCounter}`,
                timestamp,
                level: level as LogcatLevel,
                tag,
                pid: parseInt(pidStr, 10),
                tid: parseInt(tidStr, 10),
                message,
                raw: line,
            };
        }

        // Last resort: return as raw entry to not lose any log lines
        // This ensures stack traces and continuation lines are preserved
        if (line.length > 0) {
            return {
                id: `log-${++this.logIdCounter}`,
                timestamp: new Date(),
                level: 'V' as LogcatLevel,
                tag: 'raw',
                pid: 0,
                tid: 0,
                message: line,
                raw: line,
            };
        }

        return null;
    }

    private isCrashStart(entry: LogcatEntry): boolean {
        return (
            entry.level === 'E' &&
            (entry.tag === 'AndroidRuntime' || entry.tag === 'FATAL') &&
            (entry.message.includes('FATAL EXCEPTION') || entry.message.includes('Exception'))
        );
    }

    private isCrashEnd(entry: LogcatEntry): boolean {
        // Crash typically ends after stack trace lines; stop when we leave AndroidRuntime and not in stack trace.
        return (
            this.currentCrashBuffer.length > 5 &&
            entry.tag !== 'AndroidRuntime' &&
            !entry.message.startsWith('\tat ') &&
            !entry.message.startsWith('at ') &&
            !entry.message.startsWith('Caused by:')
        );
    }

    private processCrashBuffer(): void {
        if (this.currentCrashBuffer.length === 0) return;

        const rawLog = this.currentCrashBuffer.join('\n');
        const firstLine = this.currentCrashBuffer[0];
        const firstEntry = this.parseLogLine(firstLine);
        if (!firstEntry) return;

        let exceptionType = 'Unknown Exception';
        let exceptionMessage = '';
        const stackTrace: string[] = [];

        for (const line of this.currentCrashBuffer) {
            const parsed = this.parseLogLine(line);
            if (!parsed) continue;

            const exMatch = parsed.message.match(/^([\w.]+Exception|[\w.]+Error):\s*(.*)$/);
            if (exMatch) {
                exceptionType = exMatch[1];
                exceptionMessage = exMatch[2];
            }

            if (parsed.message.startsWith('\tat ') || parsed.message.startsWith('at ')) {
                stackTrace.push(parsed.message);
            }
        }

        const crash: CrashLog = {
            id: `crash-${++this.crashIdCounter}`,
            timestamp: firstEntry.timestamp,
            packageName: this.targetPackage || 'Unknown',
            pid: firstEntry.pid,
            exceptionType,
            exceptionMessage,
            stackTrace,
            rawLog,
        };

        this.onCrashCallback?.(crash);
    }

    onLogEntry(callback: (entry: LogcatEntry) => void): void {
        this.onLogEntryCallback = callback;
    }

    onCrash(callback: (crash: CrashLog) => void): void {
        this.onCrashCallback = callback;
    }

    onError(callback: (error: string) => void): void {
        this.onErrorCallback = callback;
    }

    isStreaming(): boolean {
        return this.logcatProcess !== null;
    }

    dispose(): void {
        this.stopStreaming();
        this.onLogEntryCallback = null;
        this.onCrashCallback = null;
        this.onErrorCallback = null;
    }
}
