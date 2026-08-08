import { Monitor, Play, Info, Link } from 'lucide-react';

interface PlaceholderProps {
    error?: string;
    isConnecting?: boolean;
    onStart?: () => void;
}

export function Placeholder({ error, isConnecting, onStart }: PlaceholderProps) {
    if (error) {
        return (
            <div className="phone-frame">
                <div className="phone-screen">
                    {/* Notch */}
                    <div className="phone-notch">
                        <div className="phone-notch-dot" />
                    </div>

                    {/* Error State */}
                    <div className="error-state">
                        <div className="error-icon">
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <path d="M12 9v4m0 4h.01M5.07 19H19a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.27 16A2 2 0 0 0 5.07 19z" />
                            </svg>
                        </div>
                        <h3 className="error-title">Connection Lost</h3>
                        <p className="error-message">{error}</p>
                        <button className="error-retry-btn" onClick={onStart}>
                            <svg
                                width="8"
                                height="8"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                            </svg>
                            <span>Retry</span>
                        </button>
                    </div>

                    {/* Side Buttons */}
                    <div className="phone-button-right" style={{ top: 80, height: 40 }} />
                    <div className="phone-button-right" style={{ top: 128, height: 24 }} />
                    <div className="phone-button-left" style={{ top: 112, height: 48 }} />
                </div>
            </div>
        );
    }

    // Connecting State
    if (isConnecting) {
        return (
            <div className="phone-frame">
                <div className="phone-screen">
                    {/* Notch */}
                    <div className="phone-notch">
                        <div className="phone-notch-dot" />
                    </div>

                    {/* Loading State */}
                    <div className="loading-state">
                        <div className="loading-spinner">
                            <svg className="loading-svg" viewBox="0 0 36 36">
                                <circle
                                    cx="18"
                                    cy="18"
                                    r="16"
                                    fill="none"
                                    stroke="rgba(48, 54, 61, 0.5)"
                                    strokeWidth="2"
                                />
                                <circle
                                    cx="18"
                                    cy="18"
                                    r="16"
                                    fill="none"
                                    stroke="url(#loadingGradient)"
                                    strokeWidth="2"
                                    strokeDasharray="100"
                                    strokeDashoffset="75"
                                    strokeLinecap="round"
                                    className="loading-circle"
                                />
                                <defs>
                                    <linearGradient
                                        id="loadingGradient"
                                        x1="0%"
                                        y1="0%"
                                        x2="100%"
                                        y2="0%"
                                    >
                                        <stop offset="0%" stopColor="#bc8cff" />
                                        <stop offset="100%" stopColor="#58a6ff" />
                                    </linearGradient>
                                </defs>
                            </svg>
                            <div className="loading-icon">
                                <Link size={14} color="var(--vsc-text-muted)" />
                            </div>
                        </div>
                        <p className="loading-text">Connecting...</p>
                    </div>

                    {/* Side Buttons */}
                    <div className="phone-button-right" style={{ top: 80, height: 40 }} />
                    <div className="phone-button-right" style={{ top: 128, height: 24 }} />
                    <div className="phone-button-left" style={{ top: 112, height: 48 }} />
                </div>
            </div>
        );
    }

    return (
        <div className="phone-frame">
            <div className="phone-screen">
                {/* Notch */}
                <div className="phone-notch">
                    <div className="phone-notch-dot" />
                </div>

                {/* Placeholder State */}
                <div className="placeholder-state">
                    <div className="placeholder-icon-wrapper">
                        <div className="placeholder-icon-bg">
                            <Monitor size={24} color="var(--vsc-text-muted)" />
                        </div>
                        <button className="placeholder-play-button" onClick={onStart}>
                            <Play size={10} fill="white" color="white" />
                        </button>
                    </div>
                    <p className="placeholder-text">Press play to start mirroring</p>
                    <div className="placeholder-info">
                        <Info size={8} />
                        <span>1080 × 2400 @ 60fps</span>
                    </div>
                </div>

                {/* Side Buttons */}
                <div className="phone-button-right" style={{ top: 80, height: 40 }} />
                <div className="phone-button-right" style={{ top: 128, height: 24 }} />
                <div className="phone-button-left" style={{ top: 112, height: 48 }} />
            </div>
        </div>
    );
}
