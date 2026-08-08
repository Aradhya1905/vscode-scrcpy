import { AlertTriangle, ExternalLink, ListChecks, RefreshCw, RotateCcw } from 'lucide-react';
import type { DiagnosticResult } from '../../types';
import { classifyError, errorCopy } from './errorKinds';

interface ErrorStateProps {
    error: string;
    /** Output of the last diagnostic the user ran, if any */
    diagnostic?: DiagnosticResult;
    isDiagnosticRunning?: boolean;
    onRetry?: () => void;
    onCheckDevices?: () => void;
    onRestartAdbServer?: () => void;
    onTroubleshooting?: () => void;
}

/**
 * Failure surface: a full-width card, not a phone screen.
 *
 * Retry alone is a dead end for the common causes - unauthorised device, adb
 * server down, another scrcpy holding the device - because retrying unchanged
 * fails the same way. The two diagnostics below are read-only and are things
 * the user could already run in a terminal.
 * See docs/changes/06-state-surfaces.md
 */
export function ErrorState({
    error,
    diagnostic,
    isDiagnosticRunning = false,
    onRetry,
    onCheckDevices,
    onRestartAdbServer,
    onTroubleshooting,
}: ErrorStateProps) {
    const kind = classifyError(error);
    const { title, hint } = errorCopy(kind);

    return (
        <div className="error-card" role="alert">
            <div className="error-card-head">
                <span className="error-card-glyph" aria-hidden="true">
                    <AlertTriangle size={14} />
                </span>
                <h3 className="error-card-title">{title}</h3>
            </div>

            <p className="error-card-hint">{hint}</p>

            {/* Selectable and wrapped: the raw text is often the only thing that
                identifies the failure, so it has to be copyable. */}
            <pre className="error-card-raw">{error}</pre>

            <div className="error-card-actions">
                <button
                    className="state-action state-action-primary focus-ring"
                    onClick={onRetry}
                    type="button"
                >
                    <RotateCcw size={12} />
                    <span>Retry</span>
                </button>
                <button
                    className="state-action focus-ring"
                    onClick={onCheckDevices}
                    disabled={isDiagnosticRunning}
                    type="button"
                >
                    <ListChecks size={12} />
                    <span>Check devices</span>
                </button>
                <button
                    className="state-action focus-ring"
                    onClick={onRestartAdbServer}
                    disabled={isDiagnosticRunning}
                    type="button"
                >
                    <RefreshCw size={12} />
                    <span>Restart adb server</span>
                </button>
                <button
                    className="state-action focus-ring"
                    onClick={onTroubleshooting}
                    type="button"
                >
                    <ExternalLink size={12} />
                    <span>Troubleshooting</span>
                </button>
            </div>

            {(isDiagnosticRunning || diagnostic) && (
                <div className="error-card-diagnostic" aria-live="polite">
                    <div className="error-card-diagnostic-label">
                        {isDiagnosticRunning
                            ? 'Running…'
                            : diagnostic?.action === 'check-devices'
                              ? 'adb devices -l'
                              : 'adb kill-server && adb start-server'}
                    </div>
                    {!isDiagnosticRunning && diagnostic && (
                        <pre
                            className={`error-card-raw${
                                diagnostic.success ? '' : ' error-card-raw-failed'
                            }`}
                        >
                            {diagnostic.output}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}
