import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { DeviceSelector } from '../components';
import { useVSCodeMessages } from '../hooks';
import type { AppProcess, DeviceListItem, ExtensionMessage, LogcatEntry } from '../types';
import { EnhancedLogsPanel } from '../components/logs/EnhancedLogsPanel';
import '../styles/logcat.css';

export default function LogcatApp() {
    const [devices, setDevices] = useState<DeviceListItem[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

    const [logcatRunning, setLogcatRunning] = useState(false);
    const [logcatError, setLogcatError] = useState<string | undefined>(undefined);
    const [logEntries, setLogEntries] = useState<LogcatEntry[]>([]);
    const [selectedApp, setSelectedApp] = useState<string | null>(null);
    const [packages, setPackages] = useState<string[]>([]);
    const [apps, setApps] = useState<AppProcess[]>([]);
    const [manuallyStopped, setManuallyStopped] = useState(false);

    const handleMessage = useCallback((message: ExtensionMessage) => {
        switch (message.type) {
            case 'device-list':
                setDevices(message.devices);
                break;
            case 'device-selected':
                setSelectedDeviceId(message.deviceId);
                setManuallyStopped(false);
                break;

            case 'logcat-entry':
                setLogEntries((prev) => {
                    const next = [...prev, message.entry];
                    return next.length > 2000 ? next.slice(next.length - 2000) : next;
                });
                break;
            case 'logcat-error':
                setLogcatError(message.error);
                break;
            case 'logcat-started':
                setLogcatRunning(true);
                setLogcatError(undefined);
                setManuallyStopped(false);
                break;
            case 'logcat-stopped':
                setLogcatRunning(false);
                break;
            case 'logcat-cleared':
                setLogEntries([]);
                break;
            case 'logcat-apps':
                setApps(message.apps);
                break;
            case 'logcat-packages':
                setPackages(message.packages);
                break;
            default:
                break;
        }
    }, []);

    const { postMessage } = useVSCodeMessages(handleMessage);

    const handleStartStreaming = useCallback(
        (packageName?: string) => {
            setLogcatError(undefined);
            postMessage({
                command: 'logcat-start',
                packageName,
                logLevel: 'V',
                buffers: ['main', 'crash'],
                clear: true,
            });
        },
        [postMessage]
    );

    const handleStopStreaming = useCallback(() => {
        setManuallyStopped(true);
        postMessage({ command: 'logcat-stop' });
    }, [postMessage]);

    const handleClearLogs = useCallback(() => {
        setLogEntries([]);
        postMessage({ command: 'logcat-clear' });
    }, [postMessage]);

    const handleRefreshApps = useCallback(() => {
        postMessage({ command: 'logcat-get-packages' });
        postMessage({ command: 'logcat-get-apps' });
    }, [postMessage]);

    // Initial fetches
    useEffect(() => {
        postMessage({ command: 'get-device-list' });
        postMessage({ command: 'ready' });
    }, [postMessage]);

    // Auto-start logcat when device is selected (but not if manually stopped)
    useEffect(() => {
        if (selectedDeviceId && !logcatRunning && !manuallyStopped) {
            handleStartStreaming();
        }
    }, [selectedDeviceId, logcatRunning, manuallyStopped, handleStartStreaming]);

    const errorCount = useMemo(() => {
        return logEntries.filter((log) => log.level === 'E' || log.level === 'F').length;
    }, [logEntries]);

    const warningCount = useMemo(() => {
        return logEntries.filter((log) => log.level === 'W').length;
    }, [logEntries]);

    return (
        <div className="logcat-root">
            <div className="logcat-header">
                <div className="logcat-title-section">
                    <div className="logcat-icon-badge">
                        <Activity size={18} />
                    </div>
                    <div className="logcat-title-content">
                        <h1 className="logcat-title">ADB Logcat</h1>
                        <p className="logcat-subtitle">
                            Real-time Android device logs with filtering and search
                        </p>
                    </div>
                </div>

                <div className="logcat-header-actions">
                    {logcatRunning && (
                        <div className="logcat-stats">
                            {errorCount > 0 && (
                                <div className="logcat-stat logcat-stat-error">
                                    <AlertTriangle size={14} />
                                    <span>{errorCount}</span>
                                </div>
                            )}
                            {warningCount > 0 && (
                                <div className="logcat-stat logcat-stat-warning">
                                    <AlertTriangle size={14} />
                                    <span>{warningCount}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <DeviceSelector
                        devices={devices}
                        selectedDeviceId={selectedDeviceId}
                        dropdownPlacement="down"
                        onSelectDevice={(id) =>
                            postMessage({ command: 'select-device', deviceId: id })
                        }
                        onRefresh={() => postMessage({ command: 'get-device-list' })}
                    />
                </div>
            </div>

            <div className="logcat-body">
                {logcatError && (
                    <div className="logcat-error-banner">
                        <AlertTriangle size={16} />
                        <span>{logcatError}</span>
                    </div>
                )}

                <EnhancedLogsPanel
                    logs={logEntries}
                    apps={apps}
                    packages={packages}
                    isStreaming={logcatRunning}
                    selectedApp={selectedApp}
                    onAppSelect={setSelectedApp}
                    onStartStreaming={handleStartStreaming}
                    onStopStreaming={handleStopStreaming}
                    onClearLogs={handleClearLogs}
                    onRefreshApps={handleRefreshApps}
                />
            </div>
        </div>
    );
}
