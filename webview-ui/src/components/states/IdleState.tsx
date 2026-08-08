import { Monitor, Play } from 'lucide-react';
import type { DeviceInfo } from '../../types';
import { DeviceSilhouette } from './DeviceSilhouette';

interface IdleStateProps {
    /** Last device info seen this session; absent before any stream has run */
    deviceInfo?: DeviceInfo;
    /** Name from the ADB device list - available with no stream at all */
    deviceName?: string;
    /** Resolution actually decoded this session, 0 when nothing has streamed yet */
    lastVideoWidth?: number;
    lastVideoHeight?: number;
    onStart?: () => void;
}

/**
 * Pre-stream resting state.
 *
 * The spec line is built only from things that were actually observed - the
 * model and Android version reported by the device, and the resolution the
 * decoder produced. With no data the line is omitted rather than invented; the
 * fixed resolution this replaces was fiction on every device that didn't happen
 * to match it. See docs/changes/06-state-surfaces.md
 */
export function IdleState({
    deviceInfo,
    deviceName,
    lastVideoWidth = 0,
    lastVideoHeight = 0,
    onStart,
}: IdleStateProps) {
    const specs: string[] = [];

    const model = deviceInfo?.model || deviceName;
    if (model) {
        specs.push(model);
    }
    if (deviceInfo?.androidVersion) {
        specs.push(`Android ${deviceInfo.androidVersion}`);
    }
    if (lastVideoWidth > 0 && lastVideoHeight > 0) {
        specs.push(`${lastVideoWidth} × ${lastVideoHeight}`);
    }

    return (
        <DeviceSilhouette>
            <div className="placeholder-state">
                <div className="placeholder-icon-wrapper">
                    <div className="placeholder-icon-bg">
                        <Monitor size={24} color="var(--text-muted)" />
                    </div>
                    <button
                        className="placeholder-play-button focus-ring"
                        onClick={onStart}
                        type="button"
                        aria-label="Start mirroring"
                    >
                        <Play size={10} fill="currentColor" color="currentColor" />
                    </button>
                </div>
                <p className="placeholder-text">Press play to start mirroring</p>
                {specs.length > 0 && <p className="placeholder-specs">{specs.join(' • ')}</p>}
            </div>
        </DeviceSilhouette>
    );
}
