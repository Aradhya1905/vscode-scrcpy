import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { useVirtualList } from '../../hooks';
import { EnhancedLogEntryRow } from './EnhancedLogEntryRow';

type LogFilters = {
    levels: Set<LogcatLevel>;
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

const DEFAULT_LEVELS: LogcatLevel[] = ['D', 'I', 'W', 'E', 'F']; // all except verbose

/** Keystrokes must not re-filter 2000 entries and rebuild every row's highlight. */
const SEARCH_DEBOUNCE_MS = 120;

/** Rough height of one row; the virtual list corrects it once a row is measured. */
const ESTIMATED_ROW_HEIGHT = 56;

export interface EnhancedLogsPanelProps {
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

export function EnhancedLogsPanel({
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
}: EnhancedLogsPanelProps) {
    // Filter state
    const [filters, setFilters] = useState<LogFilters>({
        levels: new Set(DEFAULT_LEVELS),
        searchQuery: '',
        useRegex: false,
        caseSensitive: false,
    });

    // What the search box shows. Committed into `filters.searchQuery` on a debounce.
    const [searchInput, setSearchInput] = useState('');

    // UI state
    const [showAppDropdown, setShowAppDropdown] = useState(false);
    const [appSearchQuery, setAppSearchQuery] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

    // Refs
    const appSelectorRef = useRef<HTMLDivElement>(null);
    const appSelectorBtnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (searchInput === filters.searchQuery) {
            return;
        }
        const timeoutId = window.setTimeout(() => {
            setFilters((prev) => ({ ...prev, searchQuery: searchInput }));
        }, SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timeoutId);
    }, [searchInput, filters.searchQuery]);

    // Update dropdown position when opened
    const updateDropdownPosition = useCallback(() => {
        if (appSelectorBtnRef.current) {
            const rect = appSelectorBtnRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + 6,
                left: rect.left,
            });
        }
    }, []);

    // Close dropdown when clicking outside
    useEffect(() => {
        if (!showAppDropdown) return;

        updateDropdownPosition();

        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const dropdownEl = document.querySelector('.enhanced-logs-app-selector-dropdown');
            const isInsideButton = appSelectorRef.current?.contains(target);
            const isInsideDropdown = dropdownEl?.contains(target);

            if (!isInsideButton && !isInsideDropdown) {
                setShowAppDropdown(false);
                setAppSearchQuery('');
            }
        };

        // Small delay to avoid immediate close on open click
        const timeoutId = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 10);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showAppDropdown, updateDropdownPosition]);

    const filteredLogs = useMemo(() => {
        const q = filters.searchQuery.trim();
        const useQuery = q.length > 0;
        const normalizedQuery = filters.caseSensitive ? q : q.toLowerCase();
        const levels = filters.levels;

        let regex: RegExp | null = null;
        if (useQuery && filters.useRegex) {
            try {
                regex = new RegExp(q, filters.caseSensitive ? 'g' : 'gi');
            } catch {
                regex = null;
            }
        }

        return logs.filter((log) => {
            if (!levels.has(log.level)) return false;
            if (!useQuery) return true;

            if (regex) {
                // Reset lastIndex for safety across entries
                regex.lastIndex = 0;
                if (!regex.test(log.message)) {
                    regex.lastIndex = 0;
                    if (!regex.test(log.tag)) return false;
                }
                return true;
            }

            const msg = filters.caseSensitive ? log.message : log.message.toLowerCase();
            const tag = filters.caseSensitive ? log.tag : log.tag.toLowerCase();
            return msg.includes(normalizedQuery) || tag.includes(normalizedQuery);
        });
    }, [logs, filters]);

    const levelCounts = useMemo(() => {
        const counts: Record<LogcatLevel, number> = { V: 0, D: 0, I: 0, W: 0, E: 0, F: 0 };
        for (const log of logs) counts[log.level] = (counts[log.level] ?? 0) + 1;
        return counts;
    }, [logs]);

    // One object shared by every row, so `memo` on the row actually holds.
    const highlight = useMemo(
        () => ({
            query: filters.searchQuery,
            useRegex: filters.useRegex,
            caseSensitive: filters.caseSensitive,
        }),
        [filters.searchQuery, filters.useRegex, filters.caseSensitive]
    );

    const getRowKey = useCallback((index: number) => filteredLogs[index].id, [filteredLogs]);

    const {
        scrollRef,
        window: virtualWindow,
        measureRef,
        handleScroll: onVirtualScroll,
        scrollToBottom,
    } = useVirtualList({
        count: filteredLogs.length,
        getKey: getRowKey,
        estimateHeight: ESTIMATED_ROW_HEIGHT,
    });

    const handleScroll = useCallback(() => {
        onVirtualScroll();

        const element = scrollRef.current;
        if (!element) return;
        const { scrollTop, scrollHeight, clientHeight } = element;
        setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
    }, [onVirtualScroll, scrollRef]);

    // Re-pin after every render, not just on append: rows entering the window get
    // measured afterwards, which changes the total height under us.
    useLayoutEffect(() => {
        if (autoScroll) {
            scrollToBottom();
        }
    });

    const toggleLevel = useCallback((level: LogcatLevel) => {
        setFilters((prev) => {
            const levels = new Set(prev.levels);
            if (levels.has(level)) levels.delete(level);
            else levels.add(level);
            return { ...prev, levels };
        });
    }, []);

    const setErrorsOnly = useCallback(() => {
        setFilters((prev) => ({ ...prev, levels: new Set<LogcatLevel>(['E', 'F']) }));
    }, []);

    const setWarningsAndAbove = useCallback(() => {
        setFilters((prev) => ({ ...prev, levels: new Set<LogcatLevel>(['W', 'E', 'F']) }));
    }, []);

    const clearFilters = useCallback(() => {
        setSearchInput('');
        setFilters({
            levels: new Set(DEFAULT_LEVELS),
            searchQuery: '',
            useRegex: false,
            caseSensitive: false,
        });
    }, []);

    const filteredApps = useMemo(() => {
        if (!appSearchQuery.trim()) return packages;
        const q = appSearchQuery.toLowerCase();
        return packages.filter((pkg) => pkg.toLowerCase().includes(q));
    }, [packages, appSearchQuery]);

    const handleAppSelect = useCallback(
        (pkg: string | null, event?: React.MouseEvent) => {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
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

    const visibleRows = useMemo(() => {
        const rows = [];
        const lastIndex = filteredLogs.length - 1;

        for (let index = virtualWindow.startIndex; index < virtualWindow.endIndex; index++) {
            const log = filteredLogs[index];
            const nextLog = filteredLogs[index + 1];
            const isGroupEnd = !!(log.groupId && (!nextLog || nextLog.groupId !== log.groupId));

            rows.push(
                <EnhancedLogEntryRow
                    key={log.id}
                    entry={log}
                    highlight={highlight}
                    isNew={index === lastIndex}
                    isGroupEnd={isGroupEnd}
                    rowRef={measureRef(log.id)}
                />
            );
        }

        return rows;
    }, [filteredLogs, virtualWindow, highlight, measureRef]);

    // apps is currently unused in this phase, but kept for future improvements (running app selector, etc.)
    void apps;

    return (
        <div className="enhanced-logs-panel">
            <div className="enhanced-logs-filter-bar">
                <div className="enhanced-logs-filter-row">
                    <div className="enhanced-logs-app-selector" ref={appSelectorRef}>
                        <button
                            ref={appSelectorBtnRef}
                            className="enhanced-logs-app-selector-btn"
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
                                <span className="enhanced-logs-app-selector-label">
                                    {selectedApp || 'All Apps'}
                                </span>
                            </div>
                            <ChevronDown size={14} />
                        </button>

                        {showAppDropdown &&
                            createPortal(
                                <div
                                    className="enhanced-logs-app-selector-dropdown"
                                    style={{
                                        top: dropdownPosition.top,
                                        left: dropdownPosition.left,
                                    }}
                                    onWheel={(e) => e.stopPropagation()}
                                >
                                    <div className="enhanced-logs-app-selector-search">
                                        <input
                                            type="text"
                                            placeholder="Search packages…"
                                            value={appSearchQuery}
                                            onChange={(e) => setAppSearchQuery(e.target.value)}
                                            autoFocus
                                        />
                                    </div>

                                    <div
                                        className="enhanced-logs-app-selector-list"
                                        onWheel={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            className={`enhanced-logs-app-selector-item enhanced-logs-app-selector-item-all ${
                                                !selectedApp ? 'selected' : ''
                                            }`}
                                            onClick={(e) => handleAppSelect(null, e)}
                                            type="button"
                                        >
                                            <Package size={14} />
                                            <span>All Apps</span>
                                        </button>

                                        {filteredApps.map((pkg) => (
                                            <button
                                                key={pkg}
                                                className={`enhanced-logs-app-selector-item ${
                                                    selectedApp === pkg ? 'selected' : ''
                                                }`}
                                                onClick={(e) => handleAppSelect(pkg, e)}
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
                                                    <div className="enhanced-logs-app-selector-pkg">
                                                        {pkg}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>,
                                document.body
                            )}
                    </div>

                    <div style={{ width: 1, height: 24, backgroundColor: 'var(--vsc-border)' }} />

                    <div className="enhanced-logs-level-filters">
                        {ALL_LEVELS.map((level) => (
                            <button
                                key={level}
                                className={`enhanced-logs-level-btn ${
                                    filters.levels.has(level) ? 'active' : 'inactive'
                                }`}
                                data-level={level}
                                onClick={() => toggleLevel(level)}
                                title={`Toggle ${LOG_LEVEL_INFO[level].label} logs`}
                                type="button"
                            >
                                <span className="enhanced-logs-level-label">
                                    {LOG_LEVEL_INFO[level].label}
                                </span>
                                <span className="enhanced-logs-level-count">
                                    {levelCounts[level]}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="enhanced-logs-filter-row">
                    <div className="enhanced-logs-search-wrapper">
                        <Search size={14} />
                        <input
                            type="text"
                            className="enhanced-logs-search-input"
                            placeholder="Filter logs…"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                        />
                        {searchInput && (
                            <button
                                className="enhanced-logs-search-option"
                                onClick={() => setSearchInput('')}
                                type="button"
                                title="Clear search"
                            >
                                <X size={12} />
                            </button>
                        )}
                        <div className="enhanced-logs-search-options">
                            <button
                                className={`enhanced-logs-search-option ${filters.useRegex ? 'active' : ''}`}
                                onClick={() =>
                                    setFilters((prev) => ({ ...prev, useRegex: !prev.useRegex }))
                                }
                                type="button"
                                title="Use regular expression"
                            >
                                .*
                            </button>
                            <button
                                className={`enhanced-logs-search-option ${
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

                    <div className="enhanced-logs-quick-filters">
                        <button
                            className={`enhanced-logs-quick-filter-btn ${
                                filters.levels.size === 2 && filters.levels.has('E') ? 'active' : ''
                            }`}
                            onClick={setErrorsOnly}
                            type="button"
                        >
                            Errors Only
                        </button>
                        <button
                            className={`enhanced-logs-quick-filter-btn ${
                                filters.levels.size === 3 && filters.levels.has('W') ? 'active' : ''
                            }`}
                            onClick={setWarningsAndAbove}
                            type="button"
                        >
                            Warnings+
                        </button>
                        <button
                            className="enhanced-logs-quick-filter-btn"
                            onClick={clearFilters}
                            type="button"
                        >
                            Clear Filters
                        </button>
                    </div>
                </div>
            </div>

            <div className="enhanced-logs-stream-container">
                {logs.length === 0 ? (
                    <div className="enhanced-logs-empty">
                        <FileText size={56} />
                        <div className="enhanced-logs-empty-title">No logs yet</div>
                        <div className="enhanced-logs-empty-subtitle">
                            {isStreaming
                                ? 'Waiting for log entries…'
                                : 'Click Start to stream logcat'}
                        </div>
                    </div>
                ) : filteredLogs.length === 0 ? (
                    <div className="enhanced-logs-empty">
                        <Search size={56} />
                        <div className="enhanced-logs-empty-title">No matching logs</div>
                        <div className="enhanced-logs-empty-subtitle">
                            Try adjusting your filters
                        </div>
                    </div>
                ) : (
                    <div className="enhanced-logs-stream" ref={scrollRef} onScroll={handleScroll}>
                        <div className="enhanced-logs-stream-inner">
                            <div style={{ height: virtualWindow.paddingTop }} aria-hidden="true" />
                            {visibleRows}
                            <div
                                style={{ height: virtualWindow.paddingBottom }}
                                aria-hidden="true"
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="enhanced-logs-status-bar">
                <div className="enhanced-logs-status-left">
                    <div className="enhanced-logs-status-item">
                        <span>
                            Showing {filteredLogs.length} of {logs.length} entries
                        </span>
                    </div>
                    <div className="enhanced-logs-status-item errors">
                        <span>{levelCounts.E + levelCounts.F} errors</span>
                    </div>
                    <div className="enhanced-logs-status-item warnings">
                        <span>{levelCounts.W} warnings</span>
                    </div>
                </div>

                <div className="enhanced-logs-status-right">
                    <button
                        className={`enhanced-logs-status-btn ${autoScroll ? 'active' : ''}`}
                        onClick={() => setAutoScroll((v) => !v)}
                        title="Auto-scroll to new logs"
                        type="button"
                    >
                        <ArrowDown size={12} />
                        <span>Auto-scroll</span>
                    </button>

                    <button
                        className="enhanced-logs-status-btn"
                        onClick={onClearLogs}
                        title="Clear logs (UI + device buffer)"
                        type="button"
                    >
                        <Trash2 size={12} />
                        <span>Clear</span>
                    </button>

                    <button
                        className={`enhanced-logs-status-btn ${isStreaming ? 'streaming' : ''}`}
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
