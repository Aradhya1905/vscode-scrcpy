import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowUp,
    Folder,
    File as FileIcon,
    HardDrive,
    Download,
    Image,
    Film,
    Music,
    FileText,
    RefreshCw,
    Search,
    Loader2,
    AlertTriangle,
    CheckCircle2,
    Trash2,
} from 'lucide-react';
import { DeviceSelector } from '../components';
import { useVSCodeMessages } from '../hooks';
import type { DeviceFsEntry, DeviceListItem, ExtensionMessage } from '../types';

type InitialState = {
    view?: string;
    defaultPath?: string;
};

function getInitialState(): InitialState {
    return (window as any).__VSCODE_SCRCPY_INITIAL_STATE__ ?? {};
}

function normalizePath(p: string): string {
    const raw = (p || '').trim().replace(/\\/g, '/');
    if (!raw) return '/';
    if (raw === '/') return '/';
    const leading = raw.startsWith('/') ? raw : `/${raw}`;
    const collapsed = leading.replace(/\/{2,}/g, '/');
    return collapsed.length > 1 ? collapsed.replace(/\/+$/g, '') : collapsed;
}

function parentPath(p: string): string {
    const n = normalizePath(p);
    if (n === '/') return '/';
    const parts = n.split('/').filter(Boolean);
    if (parts.length <= 1) return '/';
    return `/${parts.slice(0, -1).join('/')}`;
}

export default function FileManagerApp() {
    const initial = getInitialState();
    const defaultPath = normalizePath(initial.defaultPath ?? '/sdcard');

    const [devices, setDevices] = useState<DeviceListItem[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

    const [currentPath, setCurrentPath] = useState<string>(defaultPath);
    const [entries, setEntries] = useState<DeviceFsEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [query, setQuery] = useState('');
    const [openStatus, setOpenStatus] = useState<
        { level: 'info' | 'success' | 'error'; message: string } | undefined
    >(undefined);
    const [deleteConfirmEntry, setDeleteConfirmEntry] = useState<DeviceFsEntry | null>(null);
    const [refreshSeq, setRefreshSeq] = useState(0);
    const openStatusTimerRef = useRef<number | undefined>(undefined);

    const lastRequestedPathRef = useRef<string>(defaultPath);

    const showPendingStatus = useCallback((message: string) => {
        if (openStatusTimerRef.current) {
            window.clearTimeout(openStatusTimerRef.current);
            openStatusTimerRef.current = undefined;
        }
        setOpenStatus({ level: 'info', message });
    }, []);

    const showTempStatus = useCallback(
        (status: { level: 'info' | 'success' | 'error'; message: string }) => {
            setOpenStatus(status);
            // Auto-clear after a short delay (avoid stacking timers)
            if (openStatusTimerRef.current) {
                window.clearTimeout(openStatusTimerRef.current);
            }
            openStatusTimerRef.current = window.setTimeout(() => {
                setOpenStatus(undefined);
                openStatusTimerRef.current = undefined;
            }, 2500);
        },
        []
    );

    const handleMessage = useCallback(
        (message: ExtensionMessage) => {
            switch (message.type) {
                case 'device-list':
                    setDevices(message.devices);
                    break;
                case 'device-selected':
                    setSelectedDeviceId(message.deviceId);
                    break;
                case 'fm-dir':
                    setLoading(false);
                    setError(undefined);
                    setEntries(message.entries);
                    setCurrentPath(normalizePath(message.path));
                    break;
                case 'error':
                    setLoading(false);
                    setError(message.message);
                    break;
                case 'fm-open-result':
                    showTempStatus({
                        level: message.success ? 'success' : 'error',
                        message: message.message,
                    });
                    break;
                case 'fm-delete-result':
                    showTempStatus({
                        level: message.success ? 'success' : 'error',
                        message: message.success ? 'Deleted.' : message.message,
                    });
                    if (message.success) {
                        setRefreshSeq((s) => s + 1);
                    }
                    break;
                default:
                    break;
            }
        },
        [showTempStatus]
    );

    const { postMessage } = useVSCodeMessages(handleMessage);

    const requestList = useCallback(
        (pathToList: string) => {
            const p = normalizePath(pathToList);
            lastRequestedPathRef.current = p;
            setLoading(true);
            setError(undefined);
            postMessage({
                command: 'fm-list-dir',
                path: p,
                deviceId: selectedDeviceId ?? undefined,
            });
        },
        [postMessage, selectedDeviceId]
    );

    useEffect(() => {
        // Trigger a first device list fetch (ready already happens too, but this is cheap and keeps behavior consistent).
        postMessage({ command: 'get-device-list' });
    }, [postMessage]);

    // (Re)load directory when device or path changes.
    useEffect(() => {
        if (!selectedDeviceId) return;
        requestList(currentPath);
    }, [selectedDeviceId, currentPath, requestList, refreshSeq]);

    const quickAccess = useMemo(
        () => [
            { label: 'Internal storage', icon: HardDrive, path: '/sdcard' },
            { label: 'Download', icon: Download, path: '/sdcard/Download' },
            { label: 'DCIM', icon: Image, path: '/sdcard/DCIM' },
            { label: 'Pictures', icon: Image, path: '/sdcard/Pictures' },
            { label: 'Movies', icon: Film, path: '/sdcard/Movies' },
            { label: 'Music', icon: Music, path: '/sdcard/Music' },
            { label: 'Documents', icon: FileText, path: '/sdcard/Documents' },
        ],
        []
    );

    const breadcrumbs = useMemo(() => {
        const p = normalizePath(currentPath);
        if (p === '/') return [{ label: '/', path: '/' }];

        const parts = p.split('/').filter(Boolean);
        const crumbs: { label: string; path: string }[] = [{ label: '/', path: '/' }];
        let acc = '';
        for (const part of parts) {
            acc += `/${part}`;
            crumbs.push({ label: part, path: acc });
        }
        return crumbs;
    }, [currentPath]);

    const filteredEntries = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return entries;
        return entries.filter((e) => e.name.toLowerCase().includes(q));
    }, [entries, query]);

    const navigateTo = useCallback(
        (p: string) => {
            const next = normalizePath(p);
            setCurrentPath(next);
            if (!selectedDeviceId) {
                setEntries([]);
                setError('Select a device to browse files.');
            }
        },
        [selectedDeviceId]
    );

    const handleOpenEntry = useCallback(
        (entry: DeviceFsEntry) => {
            if (entry.isDir) {
                navigateTo(entry.path);
                return;
            }

            if (!selectedDeviceId) {
                showTempStatus({ level: 'error', message: 'Select a device first.' });
                return;
            }

            showPendingStatus('Opening…');
            postMessage({
                command: 'fm-open-file',
                path: entry.path,
                deviceId: selectedDeviceId ?? undefined,
            });
        },
        [navigateTo, postMessage, selectedDeviceId, showPendingStatus, showTempStatus]
    );

    const handleDeleteEntry = useCallback(
        (entry: DeviceFsEntry) => {
            if (entry.isDir) return;

            if (!selectedDeviceId) {
                showTempStatus({ level: 'error', message: 'Select a device first.' });
                return;
            }

            // VS Code webviews can block/suppress native confirm dialogs; use an in-app confirm instead.
            setDeleteConfirmEntry(entry);
        },
        [selectedDeviceId, showTempStatus]
    );

    const canGoUp = normalizePath(currentPath) !== '/';

    const confirmDelete = useCallback(() => {
        if (!deleteConfirmEntry || !selectedDeviceId) return;
        const entry = deleteConfirmEntry;
        setDeleteConfirmEntry(null);
        showPendingStatus('Deleting…');
        postMessage({
            command: 'fm-delete',
            path: entry.path,
            isDir: false,
            deviceId: selectedDeviceId ?? undefined,
        });
    }, [deleteConfirmEntry, postMessage, selectedDeviceId, showPendingStatus]);

    const cancelDelete = useCallback(() => {
        setDeleteConfirmEntry(null);
    }, []);

    useEffect(() => {
        if (!deleteConfirmEntry) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancelDelete();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [cancelDelete, deleteConfirmEntry]);

    return (
        <div className="fm-root">
            {deleteConfirmEntry && (
                <div
                    className="fm-modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Confirm delete"
                    onMouseDown={(e) => {
                        // click outside closes
                        if (e.target === e.currentTarget) cancelDelete();
                    }}
                >
                    <div className="fm-modal" role="document">
                        <div className="fm-modal-title">Delete file?</div>
                        <div className="fm-modal-body">
                            This will permanently delete{' '}
                            <span className="fm-modal-mono">{deleteConfirmEntry.name}</span> from
                            the device.
                        </div>
                        <div className="fm-modal-actions">
                            <button
                                className="fm-btn focus-ring"
                                onClick={cancelDelete}
                                type="button"
                            >
                                Cancel
                            </button>
                            <button
                                className="fm-btn danger focus-ring"
                                onClick={confirmDelete}
                                type="button"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="fm-topbar">
                <div className="fm-title">
                    <div className="fm-title-badge">
                        <Folder size={14} />
                    </div>
                    <div className="fm-title-text">
                        <div className="fm-title-primary">Device File Manager</div>
                        <div className="fm-title-secondary">
                            Browse folders on your connected Android device
                        </div>
                    </div>
                </div>

                <div className="fm-topbar-right">
                    <DeviceSelector
                        devices={devices}
                        selectedDeviceId={selectedDeviceId}
                        dropdownPlacement="down"
                        onSelectDevice={(id) =>
                            postMessage({ command: 'select-device', deviceId: id })
                        }
                        onRefresh={() => postMessage({ command: 'get-device-list' })}
                    />
                    <button
                        className="fm-icon-btn focus-ring"
                        title="Refresh"
                        onClick={() => requestList(currentPath)}
                        disabled={!selectedDeviceId || loading}
                    >
                        <RefreshCw size={14} className={loading ? 'icon-spin' : ''} />
                    </button>
                </div>
            </div>

            <div className="fm-body">
                <aside className="fm-sidebar">
                    <div className="fm-sidebar-section">
                        <div className="fm-sidebar-title">Quick access</div>
                        <div className="fm-nav">
                            {quickAccess.map((item) => {
                                const Icon = item.icon;
                                const active =
                                    normalizePath(item.path) === normalizePath(currentPath);
                                return (
                                    <button
                                        key={item.path}
                                        className={`fm-nav-item ${active ? 'active' : ''}`}
                                        onClick={() => navigateTo(item.path)}
                                        title={item.path}
                                    >
                                        <span className="fm-nav-icon">
                                            <Icon size={14} />
                                        </span>
                                        <span className="fm-nav-label">{item.label}</span>
                                        <span className="fm-nav-path">{item.path}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="fm-sidebar-hint">
                        {selectedDeviceId ? (
                            <>
                                <div className="fm-hint-label">Device</div>
                                <div className="fm-hint-value">{selectedDeviceId}</div>
                            </>
                        ) : (
                            <>
                                <div className="fm-hint-label">No device selected</div>
                                <div className="fm-hint-value">
                                    Connect a device and pick it from the dropdown.
                                </div>
                            </>
                        )}
                    </div>
                </aside>

                <main className="fm-main">
                    <div className="fm-toolbar">
                        <button
                            className="fm-icon-btn focus-ring"
                            title="Up"
                            onClick={() => navigateTo(parentPath(currentPath))}
                            disabled={!selectedDeviceId || !canGoUp || loading}
                        >
                            <ArrowUp size={14} />
                        </button>

                        <div className="fm-breadcrumb">
                            {breadcrumbs.map((c, idx) => (
                                <button
                                    key={`${c.path}-${idx}`}
                                    className="fm-crumb"
                                    onClick={() => navigateTo(c.path)}
                                    disabled={!selectedDeviceId || loading}
                                    title={c.path}
                                >
                                    {c.label}
                                </button>
                            ))}
                        </div>

                        <div className="fm-search">
                            <Search size={14} />
                            <input
                                className="fm-search-input focus-ring"
                                placeholder="Search in folder…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="fm-alert fm-alert-error">
                            <div className="fm-alert-title">Couldn’t load folder</div>
                            <div className="fm-alert-body">{error}</div>
                        </div>
                    )}

                    {openStatus && (
                        <div className="fm-toast-overlay" aria-live="polite" aria-atomic="true">
                            <div
                                className={`fm-toast ${
                                    openStatus.level === 'error' ? 'error' : 'info'
                                }`}
                            >
                                <div className="fm-toast-row">
                                    <span className="fm-toast-icon">
                                        {openStatus.level === 'error' ? (
                                            <AlertTriangle size={16} />
                                        ) : openStatus.level === 'success' ? (
                                            <CheckCircle2 size={16} />
                                        ) : (
                                            <Loader2 size={16} className="icon-spin" />
                                        )}
                                    </span>
                                    <span className="fm-toast-text">{openStatus.message}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="fm-list">
                        {loading && (
                            <div className="fm-empty">
                                <div className="fm-empty-title">Loading…</div>
                                <div className="fm-empty-subtitle">
                                    Fetching {lastRequestedPathRef.current}
                                </div>
                            </div>
                        )}

                        {!loading && !error && filteredEntries.length === 0 && (
                            <div className="fm-empty">
                                <div className="fm-empty-title">No items</div>
                                <div className="fm-empty-subtitle">This folder is empty.</div>
                            </div>
                        )}

                        {!loading &&
                            filteredEntries.map((entry) => (
                                <div
                                    key={entry.path}
                                    className={`fm-row ${entry.isDir ? 'dir' : 'file'}`}
                                    onClick={() => handleOpenEntry(entry)}
                                    title={entry.path}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleOpenEntry(entry);
                                        }
                                    }}
                                >
                                    <span className="fm-row-icon">
                                        {entry.isDir ? (
                                            <Folder size={16} />
                                        ) : (
                                            <FileIcon size={16} />
                                        )}
                                    </span>
                                    <span className="fm-row-name">{entry.name}</span>
                                    <span className="fm-row-meta">
                                        {entry.isDir ? 'Folder' : 'File'}
                                    </span>

                                    {!entry.isDir && (
                                        <span className="fm-row-actions">
                                            <button
                                                className="fm-row-action-btn danger focus-ring"
                                                title="Delete"
                                                aria-label={`Delete ${entry.name}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteEntry(entry);
                                                }}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </span>
                                    )}
                                </div>
                            ))}
                    </div>
                </main>
            </div>
        </div>
    );
}
