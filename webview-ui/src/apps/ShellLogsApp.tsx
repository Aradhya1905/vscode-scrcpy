import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Terminal } from 'lucide-react';
import { DeviceSelector } from '../components';
import { useVSCodeMessages } from '../hooks';
import type {
    AppProcess,
    CrashLog,
    DeviceListItem,
    ExtensionMessage,
    LogcatEntry,
    QuickCommand,
    ShellCommandResult,
} from '../types';
import { LogsPanel } from '../components/logs/LogsPanel';

function toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        if (!isNaN(d.getTime())) return d;
    }
    return new Date();
}

export default function ShellLogsApp() {
    const [devices, setDevices] = useState<DeviceListItem[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

    const [shellCommand, setShellCommand] = useState<string>('');
    const [shellResult, setShellResult] = useState<ShellCommandResult | null>(null);
    const [shellExecuting, setShellExecuting] = useState(false);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([]);
    const [history, setHistory] = useState<string[]>([]);
    const [suggestions, setSuggestions] = useState<string[]>([]);

    const [logcatRunning, setLogcatRunning] = useState(false);
    const [logcatError, setLogcatError] = useState<string | undefined>(undefined);
    const [logEntries, setLogEntries] = useState<LogcatEntry[]>([]);
    const [crashes, setCrashes] = useState<CrashLog[]>([]);
    const [selectedApp, setSelectedApp] = useState<string | null>(null);
    const [packages, setPackages] = useState<string[]>([]);
    const [apps, setApps] = useState<AppProcess[]>([]);

    const handleMessage = useCallback((message: ExtensionMessage) => {
        switch (message.type) {
            case 'device-list':
                setDevices(message.devices);
                break;
            case 'device-selected':
                setSelectedDeviceId(message.deviceId);
                break;

            case 'shell-quick-commands':
                setQuickCommands(message.commands);
                break;
            case 'shell-history':
                setHistory(message.history);
                break;
            case 'shell-suggestions':
                setSuggestions(message.suggestions);
                break;
            case 'shell-output':
                setShellResult(message.result);
                setShellExecuting(false);
                break;

            case 'logcat-entry':
                setLogEntries((prev) => {
                    const next = [...prev, message.entry];
                    return next.length > 2000 ? next.slice(next.length - 2000) : next;
                });
                break;
            case 'crash-detected':
                setCrashes((prev) => {
                    const next = [message.crash, ...prev];
                    return next.length > 50 ? next.slice(0, 50) : next;
                });
                break;
            case 'logcat-error':
                setLogcatError(message.error);
                break;
            case 'logcat-started':
                setLogcatRunning(true);
                setLogcatError(undefined);
                break;
            case 'logcat-stopped':
                setLogcatRunning(false);
                break;
            case 'logcat-cleared':
                setLogEntries([]);
                setCrashes([]);
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

    // Initial fetches
    useEffect(() => {
        postMessage({ command: 'get-device-list' });
        postMessage({ command: 'shell-get-quick-commands' });
        postMessage({ command: 'shell-get-history' });
    }, [postMessage]);

    // Suggestions debounce
    useEffect(() => {
        const q = shellCommand.trim();
        if (!q) {
            setSuggestions([]);
            return;
        }
        const t = window.setTimeout(() => {
            postMessage({ command: 'shell-get-suggestions', partial: q });
        }, 150);
        return () => window.clearTimeout(t);
    }, [postMessage, shellCommand]);

    const runShell = useCallback(
        (cmd?: string) => {
            const c = (cmd ?? shellCommand).trim();
            if (!c) return;
            setShellResult(null);
            setShellExecuting(true);
            postMessage({ command: 'shell-execute', shellCommand: c });
        },
        [postMessage, shellCommand]
    );

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
        postMessage({ command: 'logcat-stop' });
    }, [postMessage]);

    const handleClearLogs = useCallback(() => {
        setLogEntries([]);
        setCrashes([]);
        postMessage({ command: 'logcat-clear' });
    }, [postMessage]);

    const handleRefreshApps = useCallback(() => {
        postMessage({ command: 'logcat-get-packages' });
        postMessage({ command: 'logcat-get-apps' });
    }, [postMessage]);

    const canUseDevice = selectedDeviceId !== null;

    const groupedQuickCommands = useMemo(() => {
        const byCategory = new Map<string, QuickCommand[]>();
        for (const qc of quickCommands) {
            const list = byCategory.get(qc.category) || [];
            list.push(qc);
            byCategory.set(qc.category, list);
        }
        return Array.from(byCategory.entries());
    }, [quickCommands]);

    return (
        <div className="sl-root">
            <div className="sl-topbar">
                <div className="sl-title">
                    <div className="sl-title-badge">
                        <Terminal size={14} />
                    </div>
                    <div className="sl-title-text">
                        <div className="sl-title-primary">ADB Shell & Logs</div>
                        <div className="sl-title-secondary">
                            Run shell commands, take screenshots, record screen, and more
                        </div>
                    </div>
                </div>

                <div className="sl-topbar-right">
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

            <div className="sl-body">
                <div className="sl-grid">
                    <section className="sl-card">
                        <div className="sl-card-header">
                            <div className="sl-card-title">Shell</div>
                            <div className="sl-card-actions">
                                <button
                                    className="sl-btn focus-ring"
                                    onClick={() => postMessage({ command: 'shell-clear-history' })}
                                    type="button"
                                    title="Clear history"
                                >
                                    Clear history
                                </button>
                            </div>
                        </div>

                        <div className="sl-shell-row">
                            <input
                                className="sl-input focus-ring"
                                placeholder={
                                    canUseDevice
                                        ? 'e.g. getprop ro.product.model (Enter to run)'
                                        : 'Select a device to run shell commands'
                                }
                                value={shellCommand}
                                onChange={(e) => {
                                    setShellCommand(e.target.value);
                                    setHistoryIndex(-1);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        runShell();
                                        setHistoryIndex(-1);
                                        return;
                                    }

                                    if (e.key === 'ArrowUp') {
                                        if (history.length === 0) return;
                                        e.preventDefault();
                                        const nextIndex = Math.min(
                                            historyIndex + 1,
                                            history.length - 1
                                        );
                                        setHistoryIndex(nextIndex);
                                        setShellCommand(history[nextIndex] ?? '');
                                        return;
                                    }

                                    if (e.key === 'ArrowDown') {
                                        if (history.length === 0) return;
                                        e.preventDefault();
                                        if (historyIndex <= 0) {
                                            setHistoryIndex(-1);
                                            setShellCommand('');
                                            return;
                                        }
                                        const nextIndex = historyIndex - 1;
                                        setHistoryIndex(nextIndex);
                                        setShellCommand(history[nextIndex] ?? '');
                                        return;
                                    }
                                }}
                                disabled={!canUseDevice}
                            />
                            <button
                                className="sl-btn primary focus-ring"
                                onClick={() => runShell()}
                                type="button"
                                title={canUseDevice ? 'Run' : 'Select a device first'}
                                disabled={!canUseDevice || !shellCommand.trim() || shellExecuting}
                            >
                                {shellExecuting ? (
                                    <>
                                        <Loader2 size={14} className="icon-spin" />
                                        Running
                                    </>
                                ) : (
                                    'Run'
                                )}
                            </button>
                        </div>

                        {suggestions.length > 0 && (
                            <div className="sl-suggestions">
                                {suggestions.map((s) => (
                                    <button
                                        key={s}
                                        className="sl-suggestion focus-ring"
                                        onClick={() => {
                                            setShellCommand(s);
                                            setHistoryIndex(-1);
                                        }}
                                        type="button"
                                        title={s}
                                        disabled={!canUseDevice}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="sl-subtitle">Quick commands</div>
                        <div className="sl-quick">
                            {groupedQuickCommands.map(([cat, cmds]) => (
                                <div key={cat} className="sl-quick-group">
                                    <div className="sl-quick-cat">{cat}</div>
                                    <div className="sl-quick-list">
                                        {cmds.map((qc) => (
                                            <button
                                                key={qc.id}
                                                className="sl-quick-btn focus-ring"
                                                onClick={() => runShell(qc.command)}
                                                type="button"
                                                title={qc.description}
                                                disabled={!canUseDevice || shellExecuting}
                                            >
                                                <span className="sl-quick-label">{qc.label}</span>
                                                <span className="sl-quick-desc">
                                                    {qc.description}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="sl-subtitle">History</div>
                        <div className="sl-history">
                            {history.length === 0 ? (
                                <div className="sl-muted">No history yet.</div>
                            ) : (
                                history.slice(0, 12).map((h) => (
                                    <button
                                        key={h}
                                        className="sl-history-item focus-ring"
                                        onClick={() => {
                                            setShellCommand(h);
                                            setHistoryIndex(-1);
                                        }}
                                        type="button"
                                        title={h}
                                        disabled={!canUseDevice}
                                    >
                                        {h}
                                    </button>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="sl-card">
                        <div className="sl-card-header">
                            <div className="sl-card-title">Shell output</div>
                        </div>

                        {!shellResult ? (
                            <div className="sl-muted">
                                {shellExecuting
                                    ? 'Running…'
                                    : 'Run a command to see stdout/stderr here.'}
                            </div>
                        ) : (
                            <div className="sl-output">
                                <div className="sl-output-meta">
                                    <span className="sl-mono">{shellResult.command}</span>
                                    <span className="sl-muted">
                                        exit {shellResult.exitCode} • {shellResult.duration}ms
                                    </span>
                                </div>

                                <div className="sl-output-grid">
                                    <div>
                                        <div className="sl-output-label">stdout</div>
                                        <pre className="sl-pre">
                                            {shellResult.stdout || '(empty)'}
                                        </pre>
                                    </div>
                                    <div>
                                        <div className="sl-output-label">stderr</div>
                                        <pre className="sl-pre error">
                                            {shellResult.stderr || '(empty)'}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                </div>

                <section className="sl-card sl-logcard">
                    <div className="sl-card-header">
                        <div className="sl-card-title">Logcat</div>
                    </div>

                    {logcatError && <div className="sl-alert">{logcatError}</div>}

                    {crashes.length > 0 && (
                        <div className="sl-crashes">
                            <div className="sl-subtitle">Crashes (latest first)</div>
                            <div className="sl-crash-list">
                                {crashes.slice(0, 5).map((c) => (
                                    <div key={c.id} className="sl-crash">
                                        <div className="sl-crash-top">
                                            <span className="sl-crash-title">
                                                {c.exceptionType}
                                            </span>
                                            <span className="sl-muted">
                                                pid {c.pid} •{' '}
                                                {toDate(c.timestamp).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <div className="sl-crash-msg">{c.exceptionMessage}</div>
                                        {c.stackTrace.length > 0 && (
                                            <pre className="sl-pre">{c.stackTrace.join('\n')}</pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <LogsPanel
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
                </section>
            </div>
        </div>
    );
}
