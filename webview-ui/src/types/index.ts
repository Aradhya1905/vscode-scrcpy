export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
    id: number;
    message: string;
    level: LogLevel;
    timestamp: Date;
}

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

export interface DeviceListItem {
    id: string;
    name: string;
    model?: string;
    status: 'device' | 'unauthorized' | 'offline';
}

export interface AppInfo {
    packageName: string;
    label: string;
    icon?: string; // Base64 or path
    isDebug: boolean;
    lastUsed?: Date;
}

export interface DeviceFsEntry {
    name: string;
    path: string;
    isDir: boolean;
}

// ===== ADB Shell & Logcat (ShellLogs) =====
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

export type LogcatLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';

export interface LogcatEntry {
    id: string;
    timestamp: any; // Date from extension host is often serialized; UI should normalize
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
    timestamp: any;
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

export interface TouchEventData {
    command: 'touch';
    action: 'down' | 'move' | 'up';
    x: number;
    y: number;
    videoWidth: number;
    videoHeight: number;
}

export interface KeyEventData {
    command: 'key';
    action: 'down' | 'up';
    keyCode: number;
    metaState: number;
}

export interface ScrollEventData {
    command: 'scroll';
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    videoWidth: number;
    videoHeight: number;
}

export interface PasteEventData {
    command: 'paste';
    text: string;
}

export interface ScrcpySettings {
    maxSize?: number;
    maxFps?: number;
    videoBitRate?: number;
}

export type WebviewMessage =
    | { command: 'start'; settings?: ScrcpySettings }
    | { command: 'stop' }
    | { command: 'ready' }
    | { command: 'home' }
    | { command: 'back' }
    | { command: 'app-switch' }
    | { command: 'screenshot' }
    | { command: 'open-file-manager' }
    | { command: 'open-shell-logs' }
    | { command: 'volume-up' }
    | { command: 'volume-down' }
    | { command: 'lock-screen' }
    | { command: 'open-camera' }
    | { command: 'screen-power-toggle'; screenOff: boolean }
    | { command: 'show-touches'; enabled: boolean }
    | { command: 'stay-awake'; enabled: boolean }
    | { command: 'dark-mode'; enabled: boolean }
    | { command: 'pick-apk-files' }
    | { command: 'install-apk'; files?: string[] }
    | { command: 'get-device-info' }
    | { command: 'get-device-list' }
    | { command: 'select-device'; deviceId: string }
    | { command: 'fm-list-dir'; path: string; deviceId?: string }
    | { command: 'fm-open-file'; path: string; deviceId?: string }
    | { command: 'fm-delete'; path: string; isDir?: boolean; deviceId?: string }
    | { command: 'get-app-list' }
    | { command: 'get-recent-apps' }
    | { command: 'get-debug-apps' }
    | { command: 'launch-app'; packageName: string }
    // Shell & Logs
    | { command: 'shell-execute'; shellCommand: string }
    | { command: 'shell-get-quick-commands' }
    | { command: 'shell-get-history' }
    | { command: 'shell-clear-history' }
    | { command: 'shell-get-suggestions'; partial: string }
    | {
          command: 'logcat-start';
          packageName?: string;
          logLevel?: LogcatLevel;
          buffers?: ('main' | 'system' | 'crash' | 'events')[];
          clear?: boolean;
      }
    | { command: 'logcat-stop' }
    | { command: 'logcat-clear' }
    | { command: 'logcat-get-apps' }
    | { command: 'logcat-get-packages' }
    | TouchEventData
    | KeyEventData
    | ScrollEventData
    | PasteEventData;

export type ExtensionMessage =
    | { type: 'connecting' }
    | { type: 'connected' }
    | { type: 'disconnected' }
    | { type: 'video'; data: string } // base64 encoded
    | { type: 'error'; message: string }
    | { type: 'apk-files-selected'; paths: string[] }
    | { type: 'apk-install-status'; level: 'info' | 'warn' | 'error'; message: string }
    | { type: 'apk-install-result'; success: boolean; message: string }
    | { type: 'device-info'; info: DeviceInfo }
    | { type: 'device-list'; devices: DeviceListItem[] }
    | { type: 'device-selected'; deviceId: string }
    | { type: 'fm-dir'; deviceId: string; path: string; entries: DeviceFsEntry[] }
    | { type: 'fm-open-result'; success: boolean; message: string }
    | { type: 'fm-delete-result'; success: boolean; message: string }
    | { type: 'app-list'; apps: AppInfo[] }
    | { type: 'recent-apps'; apps: AppInfo[] }
    | { type: 'debug-apps'; apps: AppInfo[] }
    | { type: 'app-launched'; packageName: string }
    // Shell & Logs
    | { type: 'shell-output'; result: ShellCommandResult }
    | { type: 'shell-quick-commands'; commands: QuickCommand[] }
    | { type: 'shell-history'; history: string[] }
    | { type: 'shell-suggestions'; suggestions: string[] }
    | { type: 'logcat-entry'; entry: LogcatEntry }
    | { type: 'crash-detected'; crash: CrashLog }
    | { type: 'logcat-error'; error: string }
    | { type: 'logcat-started' }
    | { type: 'logcat-stopped' }
    | { type: 'logcat-cleared' }
    | { type: 'logcat-apps'; apps: AppProcess[] }
    | { type: 'logcat-packages'; packages: string[] };
