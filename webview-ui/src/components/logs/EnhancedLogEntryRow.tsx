import { useMemo } from 'react';
import type { LogcatEntry } from '../../types';

interface EnhancedLogEntryRowProps {
    entry: LogcatEntry;
    highlight: {
        query: string;
        useRegex: boolean;
        caseSensitive: boolean;
    };
    isNew: boolean;
    isGroupEnd?: boolean;
}

// Highlight search matches in log messages
function highlightMessage(
    message: string,
    query: string,
    useRegex: boolean,
    caseSensitive: boolean
) {
    // Escape HTML to prevent XSS and display issues
    let html = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Apply search highlighting only
    if (query.trim()) {
        if (useRegex) {
            try {
                const regex = new RegExp(`(${query})`, caseSensitive ? 'g' : 'gi');
                html = html.replace(regex, '<span class="log-highlight">$1</span>');
            } catch {
                // Invalid regex, skip highlighting
            }
        } else {
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedQuery})`, caseSensitive ? 'g' : 'gi');
            html = html.replace(regex, '<span class="log-highlight">$1</span>');
        }
    }

    return html;
}

export function EnhancedLogEntryRow({
    entry,
    highlight,
    isNew,
    isGroupEnd,
}: EnhancedLogEntryRowProps) {
    const formattedTime = useMemo(() => {
        const date = new Date(entry.timestamp);
        const time = date.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        const ms = date.getMilliseconds().toString().padStart(3, '0');
        return `${time}.${ms}`;
    }, [entry.timestamp]);

    const highlightedMessage = useMemo(() => {
        return highlightMessage(
            entry.message,
            highlight.query,
            highlight.useRegex,
            highlight.caseSensitive
        );
    }, [entry.message, highlight.query, highlight.useRegex, highlight.caseSensitive]);

    // Build CSS classes for grouping
    const classNames = [
        'enhanced-log-entry',
        isNew ? 'is-new' : '',
        entry.groupId ? 'is-grouped' : '',
        entry.isGroupStart ? 'is-group-start' : '',
        isGroupEnd ? 'is-group-end' : '',
        entry.isStackTrace ? 'is-stack-trace' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={classNames} data-level={entry.level} data-group-id={entry.groupId}>
            <div className="enhanced-log-level-icon">{entry.level}</div>

            <div className="enhanced-log-content">
                {/* Only show meta on group start or non-grouped entries */}
                {(!entry.groupId || entry.isGroupStart) && (
                    <div className="enhanced-log-meta">
                        <span className="enhanced-log-time">{formattedTime}</span>
                        <span className="enhanced-log-tag">{entry.tag}</span>
                        <span className="enhanced-log-pid">PID: {entry.pid}</span>
                    </div>
                )}

                <div
                    className={`enhanced-log-message ${entry.isStackTrace ? 'stack-trace-line' : ''}`}
                    dangerouslySetInnerHTML={{ __html: highlightedMessage }}
                />
            </div>
        </div>
    );
}
