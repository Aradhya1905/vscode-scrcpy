import { memo, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { LogcatEntry } from '../../types';

type HighlightMode = {
    query: string;
    useRegex: boolean;
    caseSensitive: boolean;
};

function toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        if (!isNaN(d.getTime())) return d;
    }
    return new Date();
}

function highlightText(text: string, mode: HighlightMode | undefined): React.ReactNode {
    if (!mode) return text;
    const q = mode.query.trim();
    if (!q) return text;

    // Regex highlight
    if (mode.useRegex) {
        try {
            const flags = `g${mode.caseSensitive ? '' : 'i'}`;
            const re = new RegExp(q, flags);

            const parts: React.ReactNode[] = [];
            let lastIndex = 0;
            let m: RegExpExecArray | null;

            while ((m = re.exec(text)) !== null) {
                const start = m.index;
                const match = m[0] ?? '';

                // Avoid infinite loops on zero-length matches
                if (match.length === 0) {
                    re.lastIndex = Math.min(re.lastIndex + 1, text.length);
                    continue;
                }

                if (start > lastIndex) {
                    parts.push(text.slice(lastIndex, start));
                }
                parts.push(
                    <span key={`${start}-${lastIndex}`} className="highlight">
                        {match}
                    </span>
                );
                lastIndex = start + match.length;
            }

            if (parts.length === 0) return text;
            if (lastIndex < text.length) parts.push(text.slice(lastIndex));
            return <>{parts}</>;
        } catch {
            // Fall back to substring highlight
        }
    }

    // Substring highlight (safe)
    const haystack = mode.caseSensitive ? text : text.toLowerCase();
    const needle = mode.caseSensitive ? q : q.toLowerCase();

    const parts: React.ReactNode[] = [];
    let i = 0;
    while (i < text.length) {
        const idx = haystack.indexOf(needle, i);
        if (idx === -1) {
            parts.push(text.slice(i));
            break;
        }
        if (idx > i) parts.push(text.slice(i, idx));
        parts.push(
            <span key={`${idx}-${i}`} className="highlight">
                {text.slice(idx, idx + needle.length)}
            </span>
        );
        i = idx + needle.length;
    }

    return <>{parts}</>;
}

export interface LogEntryRowProps {
    entry: LogcatEntry;
    /**
     * Must be referentially stable across renders - it is a dependency of this
     * component's memoisation. Hoist it into a `useMemo` in the parent.
     */
    highlight?: HighlightMode;
    isNew?: boolean;
    /**
     * Owned by the parent rather than this row: virtualization unmounts rows that
     * scroll out of the window, which would otherwise silently collapse them.
     */
    isExpanded?: boolean;
    onToggleExpand?: (entryId: string) => void;
    /** Ref callback used by the virtual list to measure this row. */
    rowRef?: (element: HTMLDivElement | null) => void;
}

export const LogEntryRow = memo(function LogEntryRow({
    entry,
    highlight,
    isNew,
    isExpanded = false,
    onToggleExpand,
    rowRef,
}: LogEntryRowProps) {
    const lines = useMemo(() => entry.message.split('\n'), [entry.message]);
    const isMultiline = lines.length > 1;
    const firstLine = lines[0] ?? '';
    const remainingLines = lines.slice(1);

    const timeStr = useMemo(() => {
        const date = toDate(entry.timestamp);
        return date.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }, [entry.timestamp]);

    return (
        <div
            ref={rowRef}
            className={`log-entry level-${entry.level} ${isNew ? 'log-entry-new' : ''}`}
            onClick={() => isMultiline && onToggleExpand?.(entry.id)}
            style={{ cursor: isMultiline ? 'pointer' : 'default' }}
            title={entry.raw || ''}
        >
            <div className={`log-entry-level level-${entry.level}`}>{entry.level}</div>
            <div className="log-entry-time">{timeStr}</div>
            <div className="log-entry-tag" title={entry.tag}>
                {entry.tag}
            </div>
            <div className="log-entry-message">
                {isMultiline && (
                    <span style={{ marginRight: 6, color: 'var(--vsc-text-muted)' }}>
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                )}
                <span>{highlightText(firstLine, highlight)}</span>

                {isExpanded && remainingLines.length > 0 && (
                    <div className="log-entry-expanded">
                        {remainingLines.map((line, index) => (
                            <div key={index} className="log-entry-stack-line">
                                {highlightText(line, highlight)}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});
