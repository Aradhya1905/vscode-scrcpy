import { memo } from 'react';
import { Minus, Plus } from 'lucide-react';
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM } from '../hooks/useZoom';

interface ZoomHudProps {
    zoom: number;
    isVisible: boolean;
    /** True when the view has been panned away from centre */
    isPanned: boolean;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
    /** Keep the HUD on screen while the pointer is over it */
    onHoldVisible: () => void;
    /** Restart the auto-hide countdown when the pointer leaves */
    onReleaseVisible: () => void;
}

export const ZoomHud = memo(function ZoomHud({
    zoom,
    isVisible,
    isPanned,
    onZoomIn,
    onZoomOut,
    onReset,
    onHoldVisible,
    onReleaseVisible,
}: ZoomHudProps) {
    const percentage = Math.round(zoom * 100);
    const isDefault = zoom === DEFAULT_ZOOM && !isPanned;

    return (
        <div
            className={`zoom-hud ${isVisible ? 'visible' : ''}`}
            onPointerEnter={onHoldVisible}
            onPointerLeave={onReleaseVisible}
            onFocus={onHoldVisible}
            onBlur={onReleaseVisible}
        >
            <span className="zoom-hud-level" title="Alt + drag (or middle-drag) to pan">
                {percentage}%
            </span>

            <div className="zoom-hud-actions">
                <button
                    className="btn-icon zoom-hud-btn"
                    onClick={onZoomOut}
                    disabled={zoom <= MIN_ZOOM}
                    title="Zoom out"
                    aria-label="Zoom out"
                >
                    <Minus size={14} />
                </button>
                <button
                    className="btn-icon zoom-hud-btn"
                    onClick={onZoomIn}
                    disabled={zoom >= MAX_ZOOM}
                    title="Zoom in"
                    aria-label="Zoom in"
                >
                    <Plus size={14} />
                </button>
            </div>

            <button
                className="zoom-hud-reset"
                onClick={onReset}
                disabled={isDefault}
                title="Reset zoom to 100%"
            >
                Reset
            </button>
        </div>
    );
});
