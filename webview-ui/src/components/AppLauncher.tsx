import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react';
import type { AppInfo } from '../types';

interface AppLauncherProps {
    apps: AppInfo[];
    isConnected: boolean;
    isLoading: boolean;
    onLaunchApp: (packageName: string) => void;
    onRefresh?: () => void;
    searchInputRef?: React.RefObject<HTMLInputElement>;
}

export const AppLauncher = memo(function AppLauncher({
    apps,
    isConnected,
    isLoading,
    onLaunchApp,
    onRefresh,
    searchInputRef,
}: AppLauncherProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);
    const internalSearchRef = useRef<HTMLInputElement>(null);
    const searchRef = searchInputRef || internalSearchRef;

    const filteredApps = useMemo(() => {
        if (!searchQuery.trim()) {
            return apps;
        }

        const query = searchQuery.toLowerCase();
        return apps.filter(
            (app) =>
                app.label.toLowerCase().includes(query) ||
                app.packageName.toLowerCase().includes(query)
        );
    }, [apps, searchQuery]);

    const handleAppClick = useCallback(
        (packageName: string) => {
            if (isConnected) {
                onLaunchApp(packageName);
                setIsExpanded(false);
                setSearchQuery('');
            }
        },
        [isConnected, onLaunchApp]
    );

    const handleSearchChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            setSearchQuery(e.target.value);
            if (!isExpanded && e.target.value) {
                setIsExpanded(true);
            }
        },
        [isExpanded]
    );

    const handleFocus = useCallback(() => {
        setIsExpanded(true);
    }, []);

    const handleBlur = useCallback(() => {
        // Delay to allow click events to fire
        setTimeout(() => {
            if (!searchQuery) {
                setIsExpanded(false);
            }
        }, 200);
    }, [searchQuery]);

    // Focus search input when Ctrl+F or Cmd+F is pressed (handled by parent)
    useEffect(() => {
        if (searchRef.current && isConnected) {
            const handleKeyDown = (e: KeyboardEvent) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                    e.preventDefault();
                    searchRef.current?.focus();
                    setIsExpanded(true);
                }
            };
            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        }
    }, [searchRef, isConnected]);

    if (!isConnected) {
        return null;
    }

    return (
        <div className="app-launcher-container">
            <div className="app-launcher-search-wrapper">
                <input
                    ref={searchRef}
                    type="text"
                    className="app-launcher-search"
                    placeholder="Search apps..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    disabled={false}
                    autoComplete="off"
                    spellCheck="false"
                />
                {onRefresh && (
                    <button
                        className="app-launcher-refresh"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRefresh();
                        }}
                        title="Refresh app list"
                        disabled={isLoading}
                    >
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M1 8a7 7 0 0 1 7-7v2M15 8a7 7 0 0 1-7 7v-2M8 1l2 2-2 2M8 15l-2-2 2-2" />
                        </svg>
                    </button>
                )}
            </div>

            {isExpanded && (
                <div className="app-launcher-dropdown">
                    {isLoading && apps.length === 0 ? (
                        <div className="app-launcher-loading">
                            <p>Loading apps...</p>
                        </div>
                    ) : apps.length === 0 ? (
                        <div className="app-launcher-empty">
                            <p>No apps loaded</p>
                            {onRefresh && (
                                <p className="app-launcher-empty-hint">
                                    Click refresh to load apps
                                </p>
                            )}
                        </div>
                    ) : filteredApps.length === 0 ? (
                        <div className="app-launcher-empty">
                            <p>No apps found</p>
                            {searchQuery && (
                                <p className="app-launcher-empty-hint">
                                    Try a different search term
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="app-launcher-list">
                            {filteredApps.slice(0, 50).map((app) => (
                                <button
                                    key={app.packageName}
                                    className={`app-launcher-item ${
                                        app.isDebug ? 'debug-app' : ''
                                    }`}
                                    onClick={() => handleAppClick(app.packageName)}
                                    title={app.packageName}
                                >
                                    <div className="app-launcher-icon">
                                        {app.icon ? (
                                            <img src={app.icon} alt={app.label} />
                                        ) : (
                                            <div className="app-launcher-icon-placeholder">
                                                {app.label.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                    </div>
                                    <div className="app-launcher-info">
                                        <div className="app-launcher-label">{app.label}</div>
                                        <div className="app-launcher-package">
                                            {app.packageName}
                                        </div>
                                    </div>
                                    {app.isDebug && (
                                        <div className="app-launcher-debug-badge">DEBUG</div>
                                    )}
                                </button>
                            ))}
                            {filteredApps.length > 50 && (
                                <div className="app-launcher-more">
                                    <p>Showing first 50 of {filteredApps.length} apps</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});
