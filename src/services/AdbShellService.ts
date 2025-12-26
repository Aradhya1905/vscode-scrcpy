import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { AdbPathResolver } from './AdbPathResolver';

export interface ShellCommandResult {
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
}

export interface QuickCommand {
    id: string;
    label: string;
    icon: string;
    command: string;
    description: string;
    category: 'info' | 'app' | 'system' | 'debug' | 'media' | 'network';
}

export class AdbShellService {
    private commandHistory: string[] = [];
    private maxHistorySize = 100;

    constructor(private context: vscode.ExtensionContext) {
        this.commandHistory = this.context.globalState.get<string[]>('adb.shellHistory', []);
    }

    /**
     * Execute an ADB shell command on the device.
     * Note: command is executed within the device shell context.
     */
    async executeCommand(deviceId: string, command: string): Promise<ShellCommandResult> {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const sanitizedCommand = this.sanitizeCommand(command);
            const args = ['-s', deviceId, 'shell', sanitizedCommand];
            const adb = spawn(AdbPathResolver.getAdbCommand(), args, { windowsHide: true });

            let stdout = '';
            let stderr = '';

            adb.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            adb.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            adb.on('close', (code) => {
                const duration = Date.now() - startTime;
                this.addToHistory(command);

                resolve({
                    command: sanitizedCommand,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exitCode: code ?? 0,
                    duration,
                });
            });

            adb.on('error', (err) => {
                reject(new Error(`Failed to execute command: ${err.message}`));
            });
        });
    }

    /**
     * Execute a raw ADB command (not shell).
     */
    async executeAdbCommand(deviceId: string, args: string[]): Promise<ShellCommandResult> {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const fullArgs = ['-s', deviceId, ...args];
            const adb = spawn(AdbPathResolver.getAdbCommand(), fullArgs, { windowsHide: true });

            let stdout = '';
            let stderr = '';

            adb.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            adb.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            adb.on('close', (code) => {
                resolve({
                    command: args.join(' '),
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exitCode: code ?? 0,
                    duration: Date.now() - startTime,
                });
            });

            adb.on('error', (err) => {
                reject(new Error(`Failed to execute ADB command: ${err.message}`));
            });
        });
    }

    /**
     * Basic sanitization for shell commands (runs on the device).
     * This intentionally stays conservative; we trim, and let ADB shell handle quoting/pipes.
     */
    private sanitizeCommand(command: string): string {
        return (command || '').trim();
    }

    private addToHistory(command: string): void {
        const trimmed = (command || '').trim();
        if (!trimmed) return;

        if (this.commandHistory[0] === trimmed) {
            return;
        }

        this.commandHistory.unshift(trimmed);
        if (this.commandHistory.length > this.maxHistorySize) {
            this.commandHistory = this.commandHistory.slice(0, this.maxHistorySize);
        }

        void this.context.globalState.update('adb.shellHistory', this.commandHistory);
    }

    getHistory(): string[] {
        return [...this.commandHistory];
    }

    clearHistory(): void {
        this.commandHistory = [];
        void this.context.globalState.update('adb.shellHistory', []);
    }

    getQuickCommands(): QuickCommand[] {
        return [
            // Device Info
            {
                id: 'device-info',
                label: 'Device Info',
                icon: 'smartphone',
                command:
                    'getprop ro.product.model && getprop ro.build.version.release && getprop ro.build.version.sdk',
                description: 'Get device model, Android version, and SDK',
                category: 'info',
            },
            {
                id: 'battery-info',
                label: 'Battery Status',
                icon: 'battery',
                command: 'dumpsys battery',
                description: 'Detailed battery information',
                category: 'info',
            },
            {
                id: 'memory-info',
                label: 'Memory Usage',
                icon: 'memory',
                command: 'cat /proc/meminfo | head -10',
                description: 'RAM usage information',
                category: 'info',
            },
            {
                id: 'storage-info',
                label: 'Storage',
                icon: 'hard-drive',
                command: 'df -h /data /sdcard',
                description: 'Storage usage information',
                category: 'info',
            },

            // App Management
            {
                id: 'list-apps',
                label: 'List Apps',
                icon: 'package',
                command: 'pm list packages -3',
                description: 'List all third-party installed apps',
                category: 'app',
            },
            {
                id: 'running-apps',
                label: 'Running Apps',
                icon: 'activity',
                command: 'dumpsys activity recents | grep "Recent #" | head -10',
                description: 'Show recently used apps',
                category: 'app',
            },
            {
                id: 'current-activity',
                label: 'Current Activity',
                icon: 'layout',
                command: 'dumpsys activity activities | grep mResumedActivity',
                description: 'Show current foreground activity',
                category: 'app',
            },

            // Network
            {
                id: 'network-info',
                label: 'Network Info',
                icon: 'wifi',
                command: 'ip addr show wlan0 | grep inet',
                description: 'WiFi IP address',
                category: 'network',
            },
            {
                id: 'wifi-status',
                label: 'WiFi Status',
                icon: 'signal',
                command: 'dumpsys wifi | grep "mWifiInfo"',
                description: 'WiFi connection details',
                category: 'network',
            },

            // System
            {
                id: 'cpu-info',
                label: 'CPU Usage',
                icon: 'cpu',
                command: 'top -n 1 -b | head -15',
                description: 'CPU usage snapshot',
                category: 'system',
            },
            {
                id: 'processes',
                label: 'Processes',
                icon: 'list',
                command: 'ps -A | head -20',
                description: 'List running processes',
                category: 'system',
            },

            // Debug
            {
                id: 'layout-bounds',
                label: 'Toggle Layout Bounds',
                icon: 'grid',
                command:
                    'CUR=$(getprop debug.layout 2>/dev/null); ' +
                    'if [ "$CUR" = "true" ]; then ' +
                    '  setprop debug.layout false; echo "Layout bounds: OFF"; ' +
                    'else ' +
                    '  setprop debug.layout true; echo "Layout bounds: ON"; ' +
                    'fi; ' +
                    // Nudge system UI to reflect the change (best-effort; harmless if it fails)
                    'service call activity 1599295570 >/dev/null 2>&1 || true',
                description: 'Show/hide layout bounds',
                category: 'debug',
            },

            // Media
            {
                id: 'screenshot',
                label: 'Screenshot',
                icon: 'camera',
                command:
                    'screencap -p /sdcard/screenshot.png && echo "Saved to /sdcard/screenshot.png"',
                description: 'Capture screenshot to device',
                category: 'media',
            },
            {
                id: 'screen-record-start',
                label: 'Start Recording',
                icon: 'video',
                command:
                    'OUT=/sdcard/recording.mp4; ' +
                    'PIDFILE=/sdcard/.vscode-scrcpy-screenrecord.pid; ' +
                    // Try to detach so the command returns immediately (so UI stays responsive)
                    '(nohup screenrecord --time-limit 180 "$OUT" >/dev/null 2>&1 & echo $! > "$PIDFILE") >/dev/null 2>&1 ' +
                    '|| (screenrecord --time-limit 180 "$OUT" >/dev/null 2>&1 & echo $! > "$PIDFILE"); ' +
                    'echo "Recording started: $OUT"; ' +
                    'echo "Tip: run Stop Recording to finish early."',
                description: 'Start screen recording (3 min max)',
                category: 'media',
            },
            {
                id: 'screen-record-stop',
                label: 'Stop Recording',
                icon: 'square',
                command:
                    'PIDFILE=/sdcard/.vscode-scrcpy-screenrecord.pid; ' +
                    'if [ -f "$PIDFILE" ]; then ' +
                    '  PID=$(cat "$PIDFILE" 2>/dev/null); ' +
                    '  if [ -n "$PID" ]; then kill -2 "$PID" 2>/dev/null || kill "$PID" 2>/dev/null; fi; ' +
                    '  rm -f "$PIDFILE"; ' +
                    'fi; ' +
                    // Fallbacks across Android toolsets (toybox/busybox/toolbox variants)
                    '(toybox pkill -2 screenrecord || pkill -2 screenrecord || killall -2 screenrecord) 2>/dev/null || true; ' +
                    'echo "Stop signal sent to screenrecord."',
                description: 'Stop screen recording (saves the file)',
                category: 'media',
            },
        ];
    }

    getCommandSuggestions(partial: string): string[] {
        const commonCommands = [
            'getprop',
            'pm list packages',
            'pm list packages -3',
            'pm path',
            'pm clear',
            'pm dump',
            'am start',
            'am force-stop',
            'am broadcast',
            'dumpsys',
            'dumpsys battery',
            'dumpsys meminfo',
            'dumpsys activity',
            'dumpsys window',
            'dumpsys cpuinfo',
            'settings get',
            'settings put',
            'settings list',
            'input tap',
            'input swipe',
            'input text',
            'input keyevent',
            'cat /proc/meminfo',
            'cat /proc/cpuinfo',
            'df -h',
            'ls -la',
            'ps -A',
            'top -n 1',
            'netstat -an',
            'ip addr',
            'ifconfig',
            'screencap',
            'screenrecord',
        ];

        const lowerPartial = (partial || '').toLowerCase().trim();
        if (!lowerPartial) {
            return [...new Set([...this.commandHistory, ...commonCommands])].slice(0, 10);
        }

        const allCommands = [...this.commandHistory, ...commonCommands];
        const unique = [...new Set(allCommands)];

        return unique.filter((cmd) => cmd.toLowerCase().includes(lowerPartial)).slice(0, 10);
    }
}
