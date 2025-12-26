import { useEffect, useRef } from 'react';
import type { LogEntry } from '../types';

interface DebugPanelProps {
    logs: LogEntry[];
}

export function DebugPanel({ logs }: DebugPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        if (panelRef.current) {
            panelRef.current.scrollTop = panelRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="debug-panel" ref={panelRef}>
            {logs.map((log) => (
                <div key={log.id} className={`log-entry ${log.level}`}>
                    {log.timestamp.toLocaleTimeString()} - {log.message}
                </div>
            ))}
        </div>
    );
}
