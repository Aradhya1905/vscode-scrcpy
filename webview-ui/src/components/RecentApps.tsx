import { useCallback, memo } from 'react';
import type { AppInfo } from '../types';

interface RecentAppsProps {
    recentApps: AppInfo[];
    debugApps: AppInfo[];
    isConnected: boolean;
    onLaunchApp: (packageName: string) => void;
}

export const RecentApps = memo(function RecentApps({
    recentApps,
    debugApps,
    isConnected,
    onLaunchApp,
}: RecentAppsProps) {
    const handleAppClick = useCallback(
        (packageName: string) => {
            if (isConnected) {
                onLaunchApp(packageName);
            }
        },
        [isConnected, onLaunchApp]
    );

    if (!isConnected) {
        return null;
    }

    const hasDebugApps = debugApps.length > 0;
    const hasRecentApps = recentApps.length > 0;

    if (!hasDebugApps && !hasRecentApps) {
        return (
            <div className="recent-apps-container">
                <div className="recent-apps-empty">
                    <p>No recent apps</p>
                </div>
            </div>
        );
    }

    return (
        <div className="recent-apps-container">
            {hasDebugApps && (
                <div className="recent-apps-section">
                    <div className="recent-apps-section-header">
                        <span className="recent-apps-section-title">Debug Apps</span>
                        <span className="recent-apps-section-badge">{debugApps.length}</span>
                        <svg
                            className="debug-icon"
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M8 1v4M8 11v4M3 8h4m2 0h4M3.5 3.5l2.8 2.8m3.4 3.4l2.8 2.8M3.5 12.5l2.8-2.8m3.4-3.4l2.8-2.8" />
                        </svg>
                    </div>
                    <div className="recent-apps-carousel">
                        {debugApps.map((app) => (
                            <button
                                key={app.packageName}
                                className="app-card debug-app"
                                onClick={() => handleAppClick(app.packageName)}
                                title={app.label}
                            >
                                <div className="app-icon">
                                    {app.icon ? (
                                        <img src={app.icon} alt={app.label} />
                                    ) : (
                                        <div className="app-icon-placeholder">
                                            {app.label.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                </div>
                                <div className="app-label">{app.label}</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {hasRecentApps && (
                <div className="recent-apps-section">
                    <div className="recent-apps-section-header">
                        <span className="recent-apps-section-title">Recent Apps</span>
                        <span className="recent-apps-section-count">{recentApps.length}</span>
                    </div>
                    <div className="recent-apps-carousel">
                        {recentApps.map((app) => (
                            <button
                                key={app.packageName}
                                className="app-card"
                                onClick={() => handleAppClick(app.packageName)}
                                title={app.label}
                            >
                                <div className="app-icon">
                                    {app.icon ? (
                                        <img src={app.icon} alt={app.label} />
                                    ) : (
                                        <div className="app-icon-placeholder">
                                            {app.label.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                </div>
                                <div className="app-label">{app.label}</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});
