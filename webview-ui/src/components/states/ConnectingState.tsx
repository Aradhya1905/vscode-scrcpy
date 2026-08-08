import { useEffect, useState } from 'react';
import type { ConnectStage } from '../../types';
import { DeviceSilhouette } from './DeviceSilhouette';

/** How long one stage may sit before the surface admits something is wrong */
const STALL_TIMEOUT_MS = 15_000;

const STAGE_LABELS: Record<ConnectStage, string> = {
    'pushing-server': 'Pushing scrcpy server…',
    starting: 'Starting scrcpy…',
    'awaiting-video': 'Waiting for the first frame…',
};

interface ConnectingStateProps {
    /** Undefined until the first `connect-progress` message arrives */
    stage?: ConnectStage;
    onCancel?: () => void;
}

/**
 * Pending-connection surface.
 *
 * Two things the old spinner didn't do: it names the stage, so several seconds
 * of work on a cold device reads as progress rather than a freeze, and it calls
 * out a stage that has stopped advancing instead of spinning forever.
 *
 * The shimmer animates `transform` only. This surface is on screen exactly when
 * the decoder is spinning up, so it must not cost a paint per frame.
 * See docs/changes/06-state-surfaces.md
 */
export function ConnectingState({ stage, onCancel }: ConnectingStateProps) {
    const [isStalled, setIsStalled] = useState(false);

    // Restarts on every stage change: the timer measures time in *one* stage,
    // not total connect time, so a slow-but-advancing connect never trips it.
    useEffect(() => {
        setIsStalled(false);
        const timer = setTimeout(() => setIsStalled(true), STALL_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [stage]);

    const label = stage ? STAGE_LABELS[stage] : 'Connecting…';

    return (
        <DeviceSilhouette>
            <div className="connect-state">
                <div className="connect-skeleton" aria-hidden="true">
                    <div className="connect-skeleton-bar connect-skeleton-bar-lg" />
                    <div className="connect-skeleton-bar connect-skeleton-bar-md" />
                    <div className="connect-skeleton-bar connect-skeleton-bar-sm" />
                </div>

                <div className="connect-status" role="status" aria-live="polite">
                    <p className="connect-stage">{label}</p>
                    {isStalled && (
                        <>
                            <p className="connect-stall">Taking longer than usual.</p>
                            <button
                                className="state-action state-action-sm focus-ring"
                                onClick={onCancel}
                                type="button"
                            >
                                Cancel
                            </button>
                        </>
                    )}
                </div>
            </div>
        </DeviceSilhouette>
    );
}
