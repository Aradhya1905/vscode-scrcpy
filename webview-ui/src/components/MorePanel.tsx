import { useEffect, useState, type DragEvent } from 'react';
import {
    X,
    CloudUpload,
    Info,
    FolderOpen,
    Camera,
    Terminal,
    WifiCog,
    BugPlay,
    ChevronRight,
    Smartphone,
    Loader2,
    Volume2,
    Volume1,
    Lock,
    MonitorOff,
    Hand,
    Coffee,
    Moon,
    Sun,
} from 'lucide-react';
import { vscode } from '../vscode';

interface MorePanelProps {
    onClose: () => void;
    toolbarPosition?: 'top' | 'bottom';
    // Quick control toggle states (lifted to parent for persistence)
    screenOff: boolean;
    onScreenOffChange: (value: boolean) => void;
    showTouches: boolean;
    onShowTouchesChange: (value: boolean) => void;
    stayAwake: boolean;
    onStayAwakeChange: (value: boolean) => void;
    darkMode: boolean;
    onDarkModeChange: (value: boolean) => void;
}

export function MorePanel({
    onClose,
    screenOff,
    onScreenOffChange,
    showTouches,
    onShowTouchesChange,
    stayAwake,
    onStayAwakeChange,
    darkMode,
    onDarkModeChange,
}: MorePanelProps) {
    const [selectedApkPaths, setSelectedApkPaths] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [statusMessage, setStatusMessage] = useState<
        { level: 'info' | 'warn' | 'error'; message: string } | undefined
    >(undefined);

    useEffect(() => {
        const handler = (event: MessageEvent<any>) => {
            const msg = event.data;
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'apk-files-selected' && Array.isArray(msg.paths)) {
                setSelectedApkPaths(msg.paths);
                setStatusMessage({
                    level: 'info',
                    message: `Selected ${msg.paths.length} APK(s)`,
                });
            }

            if (msg.type === 'apk-install-status') {
                setInstalling(true);
                setStatusMessage({
                    level: msg.level ?? 'info',
                    message: msg.message ?? 'Installing...',
                });
            }

            if (msg.type === 'apk-install-result') {
                setInstalling(false);
                setStatusMessage({
                    level: msg.success ? 'info' : 'error',
                    message: msg.message ?? (msg.success ? 'Install complete.' : 'Install failed.'),
                });
            }
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    const handleBrowse = () => {
        vscode.postMessage({ command: 'pick-apk-files' });
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragging(false);

        const files = Array.from(event.dataTransfer.files).filter((f) =>
            f.name.toLowerCase().endsWith('.apk')
        );

        // VS Code webviews often do NOT provide absolute file paths via drag/drop.
        // Try best-effort (Electron sometimes exposes a non-standard `path` field),
        // otherwise fall back to the VS Code picker.
        const paths = files
            .map((f) => (f as any)?.path as string | undefined)
            .filter((p): p is string => !!p);

        if (paths.length > 0) {
            setSelectedApkPaths(paths);
            setStatusMessage({
                level: 'info',
                message: `Selected ${paths.length} APK(s)`,
            });
        } else {
            setStatusMessage({
                level: 'warn',
                message: "Drag-and-drop doesn't expose file paths here. Click to browse instead.",
            });
            handleBrowse();
        }
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragging(false);
    };

    const handleInstall = () => {
        setStatusMessage(undefined);
        vscode.postMessage({
            command: 'install-apk',
            files: selectedApkPaths.length > 0 ? selectedApkPaths : undefined,
        });
    };

    const removeFile = (index: number) => {
        setSelectedApkPaths((prev) => prev.filter((_, i) => i !== index));
    };

    return (
        <div className="panel-overlay">
            <div className="panel-header">
                <span className="panel-title">More Options</span>
                <button className="panel-close-btn" onClick={onClose}>
                    <X size={14} />
                </button>
            </div>

            <div className="panel-content">
                {/* APK Installer Section */}
                <div style={{ marginBottom: 16 }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 12,
                        }}
                    >
                        <div
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                background:
                                    'linear-gradient(to bottom right, rgba(88, 166, 255, 0.2), rgba(188, 140, 255, 0.2))',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Smartphone size={14} color="var(--vsc-blue)" />
                        </div>
                        <div>
                            <div
                                style={{
                                    fontSize: 14,
                                    fontWeight: 500,
                                    color: 'var(--vsc-text)',
                                }}
                            >
                                APK Installer
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--vsc-text-muted)' }}>
                                Drop or select APK files to install
                            </div>
                        </div>
                    </div>

                    {/* Drop Zone */}
                    <div
                        style={{
                            position: 'relative',
                            border: `2px dashed ${
                                isDragging ? 'var(--vsc-blue)' : 'var(--vsc-border)'
                            }`,
                            borderRadius: 12,
                            padding: 24,
                            background: isDragging
                                ? 'rgba(88, 166, 255, 0.1)'
                                : 'rgba(48, 54, 61, 0.3)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                        }}
                        onClick={handleBrowse}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                    >
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textAlign: 'center',
                                gap: 12,
                            }}
                        >
                            <div
                                style={{
                                    width: 64,
                                    height: 64,
                                    borderRadius: 16,
                                    background:
                                        'linear-gradient(to bottom right, rgba(88, 166, 255, 0.1), rgba(188, 140, 255, 0.1))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'transform 0.2s ease',
                                    transform: isDragging ? 'scale(1.1)' : 'scale(1)',
                                }}
                            >
                                <CloudUpload size={32} color="var(--vsc-blue)" />
                            </div>
                            <div>
                                <div
                                    style={{
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: 'var(--vsc-text)',
                                        marginBottom: 4,
                                    }}
                                >
                                    Drop APK files here
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--vsc-text-muted)' }}>
                                    or click to browse (recommended)
                                </div>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 10,
                                    color: 'var(--vsc-text-muted)',
                                }}
                            >
                                <Info size={10} />
                                <span>Supports split APKs and multiple files</span>
                            </div>
                        </div>
                    </div>

                    {/* Selected Files List */}
                    {statusMessage && (
                        <div
                            style={{
                                marginTop: 12,
                                padding: 10,
                                borderRadius: 10,
                                background:
                                    statusMessage.level === 'error'
                                        ? 'rgba(248, 81, 73, 0.12)'
                                        : statusMessage.level === 'warn'
                                          ? 'rgba(210, 153, 34, 0.12)'
                                          : 'rgba(88, 166, 255, 0.12)',
                                border: `1px solid ${
                                    statusMessage.level === 'error'
                                        ? 'rgba(248, 81, 73, 0.25)'
                                        : statusMessage.level === 'warn'
                                          ? 'rgba(210, 153, 34, 0.25)'
                                          : 'rgba(88, 166, 255, 0.25)'
                                }`,
                                color: 'var(--vsc-text)',
                                fontSize: 12,
                            }}
                        >
                            {statusMessage.message}
                        </div>
                    )}

                    {selectedApkPaths.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                            <div
                                style={{
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: 'var(--vsc-text-muted)',
                                    marginBottom: 8,
                                }}
                            >
                                Selected Files:
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {selectedApkPaths.map((apkPath, index) => (
                                    <div
                                        key={index}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            padding: 8,
                                            background: 'rgba(48, 54, 61, 0.5)',
                                            borderRadius: 8,
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 8,
                                                background:
                                                    'linear-gradient(to bottom right, rgba(88, 166, 255, 0.2), rgba(188, 140, 255, 0.2))',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                            }}
                                        >
                                            <Smartphone size={14} color="var(--vsc-blue)" />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div
                                                style={{
                                                    fontSize: 12,
                                                    fontWeight: 500,
                                                    color: 'var(--vsc-text)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {apkPath.split(/[/\\]/).pop()}
                                            </div>
                                            <div
                                                style={{
                                                    fontSize: 10,
                                                    color: 'var(--vsc-text-muted)',
                                                }}
                                            >
                                                {apkPath}
                                            </div>
                                        </div>
                                        <button
                                            style={{
                                                padding: 6,
                                                background: 'transparent',
                                                border: 'none',
                                                borderRadius: 4,
                                                color: 'var(--vsc-text-muted)',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s ease',
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeFile(index);
                                            }}
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Install Button */}
                            <button
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    padding: '10px 16px',
                                    marginTop: 12,
                                    background:
                                        'linear-gradient(to bottom right, var(--vsc-blue), var(--vsc-purple))',
                                    border: 'none',
                                    borderRadius: 8,
                                    color: 'white',
                                    fontSize: 14,
                                    fontWeight: 600,
                                    cursor: installing ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.2s ease',
                                    boxShadow: '0 4px 12px rgba(88, 166, 255, 0.3)',
                                    opacity: installing ? 0.8 : 1,
                                }}
                                onClick={handleInstall}
                                disabled={installing}
                            >
                                {installing ? (
                                    <Loader2 size={14} className="icon-spin" />
                                ) : (
                                    <CloudUpload size={14} />
                                )}
                                <span>{installing ? 'Installing...' : 'Install APK(s)'}</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Divider */}
                <div
                    style={{
                        height: 1,
                        background: 'var(--vsc-border)',
                        margin: '16px 0',
                    }}
                />

                {/* Additional Tools */}
                <div>
                    <div
                        style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: 'var(--vsc-text-muted)',
                            marginBottom: 8,
                        }}
                    >
                        Additional Tools
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <button
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: 12,
                                background: 'transparent',
                                border: 'none',
                                borderRadius: 12,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                textAlign: 'left',
                            }}
                            className="setting-item"
                            onClick={() => {
                                vscode.postMessage({ command: 'open-file-manager' });
                                onClose();
                            }}
                        >
                            <div
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background:
                                        'linear-gradient(to bottom right, rgba(63, 185, 80, 0.2), rgba(63, 185, 80, 0.1))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <FolderOpen size={14} color="var(--vsc-green)" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div
                                    style={{
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: 'var(--vsc-text)',
                                    }}
                                >
                                    File Manager
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--vsc-text-muted)' }}>
                                    Browse device files
                                </div>
                            </div>
                            <ChevronRight size={10} color="var(--vsc-text-muted)" />
                        </button>

                        <button
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: 12,
                                background: 'transparent',
                                border: 'none',
                                borderRadius: 12,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                textAlign: 'left',
                            }}
                            className="setting-item"
                            onClick={() => {
                                vscode.postMessage({ command: 'open-logcat' });
                                onClose();
                            }}
                        >
                            <div
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background:
                                        'linear-gradient(to bottom right, rgba(88, 166, 255, 0.2), rgba(88, 166, 255, 0.1))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <BugPlay size={14} color="var(--vsc-blue)" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div
                                    style={{
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: 'var(--vsc-text)',
                                    }}
                                >
                                    ADB Logcat
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--vsc-text-muted)' }}>
                                    Real-time Android device logs
                                </div>
                            </div>
                            <ChevronRight size={10} color="var(--vsc-text-muted)" />
                        </button>

                        <button
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: 12,
                                background: 'transparent',
                                border: 'none',
                                borderRadius: 12,
                                cursor: 'not-allowed',
                                transition: 'all 0.15s ease',
                                textAlign: 'left',
                                opacity: 0.65,
                            }}
                            className="setting-item"
                            disabled
                            title="Coming soon"
                        >
                            <div
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background:
                                        'linear-gradient(to bottom right, rgba(63, 185, 80, 0.2), rgba(63, 185, 80, 0.1))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <WifiCog size={16} strokeWidth={2.25} color="var(--vsc-green)" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div
                                    style={{
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: 'var(--vsc-text)',
                                    }}
                                >
                                    Network Inspector
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--vsc-text-muted)' }}>
                                    Inspect device connectivity (coming soon)
                                </div>
                            </div>
                            <ChevronRight size={10} color="var(--vsc-text-muted)" />
                        </button>

                        <button
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: 12,
                                background: 'transparent',
                                border: 'none',
                                borderRadius: 12,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                textAlign: 'left',
                            }}
                            className="setting-item"
                            onClick={() => {
                                vscode.postMessage({ command: 'open-shell-logs' });
                                onClose();
                            }}
                        >
                            <div
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background:
                                        'linear-gradient(to bottom right, rgba(210, 153, 34, 0.2), rgba(210, 153, 34, 0.1))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <Terminal size={14} color="var(--vsc-yellow)" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div
                                    style={{
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: 'var(--vsc-text)',
                                    }}
                                >
                                    ADB Shell
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--vsc-text-muted)' }}>
                                    Run commands, screenshots, and more
                                </div>
                            </div>
                            <ChevronRight size={10} color="var(--vsc-text-muted)" />
                        </button>
                    </div>
                </div>

                {/* Divider */}
                <div
                    style={{
                        height: 1,
                        background: 'var(--vsc-border)',
                        margin: '16px 0',
                    }}
                />

                {/* Quick Controls */}
                <div>
                    <div
                        style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: 'var(--vsc-text-muted)',
                            marginBottom: 8,
                        }}
                    >
                        Quick Controls
                    </div>
                    <div className="settings-quick-actions">
                        <button
                            className="quick-action-btn"
                            onClick={() => vscode.postMessage({ command: 'volume-up' })}
                        >
                            <div className="quick-action-icon">
                                <Volume2 size={16} />
                            </div>
                            <span className="quick-action-label">Vol Up</span>
                        </button>
                        <button
                            className="quick-action-btn"
                            onClick={() => vscode.postMessage({ command: 'volume-down' })}
                        >
                            <div className="quick-action-icon">
                                <Volume1 size={16} />
                            </div>
                            <span className="quick-action-label">Vol Down</span>
                        </button>
                        <button
                            className="quick-action-btn"
                            onClick={() => vscode.postMessage({ command: 'open-camera' })}
                        >
                            <div className="quick-action-icon">
                                <Camera size={16} />
                            </div>
                            <span className="quick-action-label">Camera</span>
                        </button>
                        <button
                            className="quick-action-btn"
                            onClick={() => vscode.postMessage({ command: 'lock-screen' })}
                        >
                            <div className="quick-action-icon">
                                <Lock size={16} />
                            </div>
                            <span className="quick-action-label">Lock</span>
                        </button>
                        <button
                            className={`quick-action-btn ${screenOff ? 'active' : ''}`}
                            onClick={() => {
                                const newValue = !screenOff;
                                onScreenOffChange(newValue);
                                vscode.postMessage({
                                    command: 'screen-power-toggle',
                                    screenOff: newValue,
                                });
                            }}
                            title="Toggle device screen on/off while keeping mirror active"
                        >
                            <div className="quick-action-icon">
                                <MonitorOff size={16} />
                            </div>
                            <span className="quick-action-label">
                                Screen{' '}
                                <span style={{ color: 'var(--vsc-green)', fontWeight: 500 }}>
                                    {screenOff ? 'Off' : 'On'}
                                </span>
                            </span>
                        </button>
                        <button
                            className={`quick-action-btn ${showTouches ? 'active' : ''}`}
                            onClick={() => {
                                const newValue = !showTouches;
                                onShowTouchesChange(newValue);
                                vscode.postMessage({ command: 'show-touches', enabled: newValue });
                            }}
                            title="Show touch indicators on device screen"
                        >
                            <div className="quick-action-icon">
                                <Hand size={16} />
                            </div>
                            <span className="quick-action-label">Touches</span>
                        </button>
                        <button
                            className={`quick-action-btn ${stayAwake ? 'active' : ''}`}
                            onClick={() => {
                                const newValue = !stayAwake;
                                onStayAwakeChange(newValue);
                                vscode.postMessage({ command: 'stay-awake', enabled: newValue });
                            }}
                            title="Keep device awake while plugged in"
                        >
                            <div className="quick-action-icon">
                                <Coffee size={16} />
                            </div>
                            <span className="quick-action-label">
                                Awake{' '}
                                <span style={{ color: 'var(--vsc-green)', fontWeight: 500 }}>
                                    {stayAwake ? 'On' : 'Off'}
                                </span>
                            </span>
                        </button>
                        <button
                            className={`quick-action-btn ${darkMode ? 'active' : ''}`}
                            onClick={() => {
                                const newValue = !darkMode;
                                onDarkModeChange(newValue);
                                vscode.postMessage({ command: 'dark-mode', enabled: newValue });
                            }}
                            title="Toggle device dark/light mode"
                        >
                            <div className="quick-action-icon">
                                {darkMode ? <Moon size={16} /> : <Sun size={16} />}
                            </div>
                            <span className="quick-action-label">
                                <span style={{ color: 'var(--vsc-green)', fontWeight: 500 }}>
                                    {darkMode ? 'Dark' : 'Light'}
                                </span>
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
