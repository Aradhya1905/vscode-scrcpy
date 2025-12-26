import type { ReactNode } from 'react';

interface TooltipProps {
    children: ReactNode;
    content: string;
    description?: string;
    icon?: ReactNode;
    iconColor?: 'blue' | 'green' | 'red' | 'purple' | 'yellow' | 'gray';
    position?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'left' | 'center' | 'right';
    shortcut?: string | string[];
    status?: { active: boolean; label: string };
    showArrow?: boolean;
}

export function Tooltip({
    children,
    content,
    description,
    icon,
    iconColor = 'gray',
    position = 'top',
    align = 'center',
    shortcut,
    status,
    showArrow = true,
}: TooltipProps) {
    const positionClass = position === 'top' ? '' : `tooltip-${position}`;
    const alignClass = align === 'right' ? 'tooltip-align-right' : '';

    const renderShortcut = () => {
        if (!shortcut) return null;
        const keys = Array.isArray(shortcut) ? shortcut : [shortcut];
        return (
            <span className="tooltip-shortcut">
                {keys.map((key, index) => (
                    <span key={index} className="tooltip-key">
                        {key}
                    </span>
                ))}
            </span>
        );
    };

    return (
        <div className="tooltip-wrapper">
            {children}
            <div className={`tooltip ${positionClass} ${alignClass}`}>
                <div className="tooltip-content">
                    <div className="tooltip-title">
                        {icon && (
                            <span className={`tooltip-icon tooltip-icon-${iconColor}`}>{icon}</span>
                        )}
                        <span>{content}</span>
                        {status && (
                            <span
                                className={`tooltip-status ${
                                    status.active
                                        ? 'tooltip-status-active'
                                        : 'tooltip-status-inactive'
                                }`}
                            >
                                <svg
                                    width="6"
                                    height="6"
                                    viewBox="0 0 6 6"
                                    fill="currentColor"
                                    style={{ flexShrink: 0 }}
                                >
                                    <circle cx="3" cy="3" r="3" />
                                </svg>
                                {status.label}
                            </span>
                        )}
                        {renderShortcut()}
                    </div>
                    {description && <div className="tooltip-desc">{description}</div>}
                </div>
                {showArrow && <div className="tooltip-arrow" />}
            </div>
        </div>
    );
}
