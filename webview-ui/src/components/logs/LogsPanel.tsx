import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDown,
    ChevronDown,
    FileText,
    Package,
    Pause,
    Play,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import type { AppProcess, LogcatEntry, LogcatLevel } from '../../types';
import { LogEntryRow } from './LogEntryRow';

type LogFilters = {
    levels: LogcatLevel[];
    searchQuery: string;
    useRegex: boolean;
    caseSensitive: boolean;
};

const LOG_LEVEL_INFO: Record<LogcatLevel, { label: string; color: string; priority: number }> = {
    V: { label: 'Verbose', color: '#8b949e', priority: 0 },
    D: { label: 'Debug', color: '#58a6ff', priority: 1 },
    I: { label: 'Info', color: '#3fb950', priority: 2 },
    W: { label: 'Warn', color: '#d29922', priority: 3 },
    E: { label: 'Error', color: '#f85149', priority: 4 },
    F: { label: 'Fatal', color: '#ff6b6b', priority: 5 },
};

const ALL_LEVELS: LogcatLevel[] = ['V', 'D', 'I', 'W', 'E', 'F'];

export interface LogsPanelProps {
    logs: LogcatEntry[];
    apps: AppProcess[];
    packages: string[];
    isStreaming: boolean;
    selectedApp: string | null;
    onAppSelect: (packageName: string | null) => void;
    onStartStreaming: (packageName?: string) => void;
    onStopStreaming: () => void;
    onClearLogs: () => void;
    onRefreshApps: () => void;
}

export function LogsPanel({
    logs,
    apps,
    packages,
    isStreaming,
    selectedApp,
    onAppSelect,
    onStartStreaming,
    onStopStreaming,
    onClearLogs,
    onRefreshApps,
}: LogsPanelProps) {
    // Filter state
    const [filters, setFilters] = useState<LogFilters>({
        levels: ['D', 'I', 'W', 'E', 'F'], // default: all except verbose
        searchQuery: '',
        useRegex: false,
        caseSensitive: false,
    });

    // UI state
    const [showAppDropdown, setShowAppDropdown] = useState(false);
    const [appSearchQuery, setAppSearchQuery] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);

    // Refs
    const streamRef = useRef<HTMLDivElement>(null);
    const lastLogCountRef = useRef(0);

    // Auto-scroll when new logs arrive
    useEffect(() => {
        if (autoScroll && logs.length > lastLogCountRef.current && streamRef.current) {
            streamRef.current.scrollTop = streamRef.current.scrollHeight;
        }
        lastLogCountRef.current = logs.length;
    }, [logs.length, autoScroll]);

    const filteredLogs = useMemo(() => {
        const q = filters.searchQuery.trim();
        const useQuery = q.length > 0;
        const normalizedQuery = filters.caseSensitive ? q : q.toLowerCase();

        let regex: RegExp | null = null;
        if (useQuery && filters.useRegex) {
            try {
                regex = new RegExp(q, filters.caseSensitive ? 'g' : 'gi');
            } catch {
                regex = null;
            }
        }

        return logs.filter((log) => {
            if (!filters.levels.includes(log.level)) return false;
            if (!useQuery) return true;

            const msg = filters.caseSensitive ? log.message : log.message.toLowerCase();
            const tag = filters.caseSensitive ? log.tag : log.tag.toLowerCase();

            if (regex) {
                // Reset lastIndex for safety across entries
                regex.lastIndex = 0;
                if (!regex.test(log.message) && !regex.test(log.tag)) return false;
                return true;
            }

            return msg.includes(normalizedQuery) || tag.includes(normalizedQuery);
        });
    }, [logs, filters]);

    const levelCounts = useMemo(() => {
        const counts: Record<LogcatLevel, number> = {
            V: 0,
            D: 0,
            I: 0,
            W: 0,
            E: 0,
            F: 0,
        };
        for (const log of logs) counts[log.level] = (counts[log.level] ?? 0) + 1;
        return counts;
    }, [logs]);

    const toggleLevel = useCallback((level: LogcatLevel) => {
        setFilters((prev) => ({
            ...prev,
            levels: prev.levels.includes(level)
                ? prev.levels.filter((l) => l !== level)
                : [...prev.levels, level].sort(
                      (a, b) => LOG_LEVEL_INFO[a].priority - LOG_LEVEL_INFO[b].priority
                  ),
        }));
    }, []);

    const setErrorsOnly = useCallback(() => {
        setFilters((prev) => ({ ...prev, levels: ['E', 'F'] }));
    }, []);

    const setWarningsAndAbove = useCallback(() => {
        setFilters((prev) => ({ ...prev, levels: ['W', 'E', 'F'] }));
    }, []);

    const clearFilters = useCallback(() => {
        setFilters({
            levels: ['D', 'I', 'W', 'E', 'F'],
            searchQuery: '',
            useRegex: false,
            caseSensitive: false,
        });
    }, []);

    const handleScroll = useCallback(() => {
        if (!streamRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = streamRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        setAutoScroll(isAtBottom);
    }, []);

    const filteredApps = useMemo(() => {
        if (!appSearchQuery.trim()) return packages;
        const q = appSearchQuery.toLowerCase();
        return packages.filter((pkg) => pkg.toLowerCase().includes(q));
    }, [packages, appSearchQuery]);

    const handleAppSelect = useCallback(
        (pkg: string | null) => {
            onAppSelect(pkg);
            setShowAppDropdown(false);
            setAppSearchQuery('');

            // If currently streaming, restart with the new package filter.
            if (isStreaming) {
                onStopStreaming();
                window.setTimeout(() => onStartStreaming(pkg || undefined), 140);
            }
        },
        [onAppSelect, isStreaming, onStopStreaming, onStartStreaming]
    );

    const handleToggleStreaming = useCallback(() => {
        if (isStreaming) onStopStreaming();
        else onStartStreaming(selectedApp || undefined);
    }, [isStreaming, onStopStreaming, onStartStreaming, selectedApp]);

    // apps is currently unused in this phase, but kept for future improvements (running app selector, etc.)
    void apps;

    return (
        <div className="logs-panel">
            <div className="logs-filter-bar">
                <div className="logs-filter-row">
                    <div className="logs-app-selector">
                        <button
                            className="logs-app-selector-btn"
                            onClick={() => {
                                setShowAppDropdown((v) => !v);
                                if (!showAppDropdown) onRefreshApps();
                            }}
                            type="button"
                            title="Filter by app package"
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    minWidth: 0,
                                }}
                            >
                                <Package size={14} />
                                <span className="logs-app-selector-label">
                                    {selectedApp || 'All Apps'}
                                </span>
                            </div>
                            <ChevronDown size={14} />
                        </button>

                        {showAppDropdown && (
                            <div className="logs-app-selector-dropdown">
                                <div className="logs-app-selector-search">
                                    <input
                                        type="text"
                                        placeholder="Search packages…"
                                        value={appSearchQuery}
                                        onChange={(e) => setAppSearchQuery(e.target.value)}
                                        autoFocus
                                    />
                                </div>

                                <button
                                    className={`logs-app-selector-item logs-app-selector-item-all ${
                                        !selectedApp ? 'selected' : ''
                                    }`}
                                    onClick={() => handleAppSelect(null)}
                                    type="button"
                                >
                                    <Package size={14} />
                                    <span>All Apps</span>
                                </button>

                                {filteredApps.map((pkg) => (
                                    <button
                                        key={pkg}
                                        className={`logs-app-selector-item ${
                                            selectedApp === pkg ? 'selected' : ''
                                        }`}
                                        onClick={() => handleAppSelect(pkg)}
                                        type="button"
                                    >
                                        <Package size={14} />
                                        <div style={{ minWidth: 0 }}>
                                            <div
                                                style={{
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {pkg.split('.').pop()}
                                            </div>
                                            <div className="logs-app-selector-pkg">{pkg}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ width: 1, height: 24, backgroundColor: 'var(--vsc-border)' }} />

                    <div className="logs-level-filters">
                        {ALL_LEVELS.map((level) => (
                            <button
                                key={level}
                                className={`logs-level-btn ${
                                    filters.levels.includes(level) ? 'active' : 'inactive'
                                }`}
                                data-level={level}
                                onClick={() => toggleLevel(level)}
                                title={`${LOG_LEVEL_INFO[level].label} (${levelCounts[level]})`}
                                type="button"
                            >
                                {level}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="logs-filter-row">
                    <div className="logs-search-wrapper">
                        <Search size={14} />
                        <input
                            type="text"
                            className="logs-search-input"
                            placeholder="Filter logs…"
                            value={filters.searchQuery}
                            onChange={(e) =>
                                setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
                            }
                        />
                        {filters.searchQuery && (
                            <button
                                className="logs-search-option"
                                onClick={() => setFilters((prev) => ({ ...prev, searchQuery: '' }))}
                                type="button"
                                title="Clear search"
                            >
                                <X size={12} />
                            </button>
                        )}
                        <div className="logs-search-options">
                            <button
                                className={`logs-search-option ${filters.useRegex ? 'active' : ''}`}
                                onClick={() =>
                                    setFilters((prev) => ({ ...prev, useRegex: !prev.useRegex }))
                                }
                                type="button"
                                title="Use regular expression"
                            >
                                .*
                            </button>
                            <button
                                className={`logs-search-option ${
                                    filters.caseSensitive ? 'active' : ''
                                }`}
                                onClick={() =>
                                    setFilters((prev) => ({
                                        ...prev,
                                        caseSensitive: !prev.caseSensitive,
                                    }))
                                }
                                type="button"
                                title="Case sensitive"
                            >
                                Aa
                            </button>
                        </div>
                    </div>

                    <div className="logs-quick-filters">
                        <button
                            className={`logs-quick-filter-btn ${
                                filters.levels.length === 2 && filters.levels.includes('E')
                                    ? 'active'
                                    : ''
                            }`}
                            onClick={setErrorsOnly}
                            type="button"
                        >
                            Errors Only
                        </button>
                        <button
                            className={`logs-quick-filter-btn ${
                                filters.levels.length === 3 && filters.levels.includes('W')
                                    ? 'active'
                                    : ''
                            }`}
                            onClick={setWarningsAndAbove}
                            type="button"
                        >
                            Warnings+
                        </button>
                        <button
                            className="logs-quick-filter-btn"
                            onClick={clearFilters}
                            type="button"
                        >
                            Clear Filters
                        </button>
                    </div>
                </div>
            </div>

            <div className="logs-stream-container">
                {logs.length === 0 ? (
                    <div className="logs-empty">
                        <FileText size={56} />
                        <div className="logs-empty-title">No logs yet</div>
                        <div className="logs-empty-subtitle">
                            {isStreaming
                                ? 'Waiting for log entries…'
                                : 'Click Start to stream logcat'}
                        </div>
                    </div>
                ) : filteredLogs.length === 0 ? (
                    <div className="logs-empty">
                        <Search size={56} />
                        <div className="logs-empty-title">No matching logs</div>
                        <div className="logs-empty-subtitle">Try adjusting your filters</div>
                    </div>
                ) : (
                    <div className="logs-stream" ref={streamRef} onScroll={handleScroll}>
                        <div className="logs-stream-inner">
                            {filteredLogs.map((log, index) => (
                                <LogEntryRow
                                    key={log.id}
                                    entry={log}
                                    highlight={{
                                        query: filters.searchQuery,
                                        useRegex: filters.useRegex,
                                        caseSensitive: filters.caseSensitive,
                                    }}
                                    isNew={index === filteredLogs.length - 1}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="logs-status-bar">
                <div className="logs-status-left">
                    <div className="logs-status-item">
                        <span>
                            Showing {filteredLogs.length} of {logs.length} entries
                        </span>
                    </div>
                    <div className="logs-status-item errors">
                        <span>{levelCounts.E + levelCounts.F} errors</span>
                    </div>
                    <div className="logs-status-item warnings">
                        <span>{levelCounts.W} warnings</span>
                    </div>
                </div>

                <div className="logs-status-right">
                    <button
                        className={`logs-status-btn ${autoScroll ? 'active' : ''}`}
                        onClick={() => setAutoScroll((v) => !v)}
                        title="Auto-scroll to new logs"
                        type="button"
                    >
                        <ArrowDown size={12} />
                        <span>Auto-scroll</span>
                    </button>

                    <button
                        className="logs-status-btn"
                        onClick={onClearLogs}
                        title="Clear logs (UI + device buffer)"
                        type="button"
                    >
                        <Trash2 size={12} />
                        <span>Clear</span>
                    </button>

                    <button
                        className={`logs-status-btn ${isStreaming ? 'streaming' : ''}`}
                        onClick={handleToggleStreaming}
                        type="button"
                        title={isStreaming ? 'Pause logcat' : 'Start logcat'}
                    >
                        {isStreaming ? (
                            <>
                                <Pause size={12} />
                                <span>Pause</span>
                            </>
                        ) : (
                            <>
                                <Play size={12} />
                                <span>Start</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
