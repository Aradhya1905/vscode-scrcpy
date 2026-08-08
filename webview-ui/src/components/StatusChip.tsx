import { memo } from 'react';
import { Zap } from 'lucide-react';
import type { ConnectionStatus, DeviceInfo } from '../types';

interface StatusChipProps {
    status: ConnectionStatus;
    /** Name from the ADB device list - available before a stream exists */
    deviceName?: string;
    /** 5s poll from DeviceInfoService; only present while a device is attached */
    deviceInfo?: DeviceInfo;
    videoWidth?: number;
    videoHeight?: number;
    /** Target fps from settings, not a measured rate */
    fps?: string;
}

function statusToDotClass(status: ConnectionStatus) {
    switch (status) {
        case 'connected':
            return 'connected';
        case 'connecting':
            return 'connecting';
        default:
            return 'disconnected';
    }
}

/**
 * The mirror view's status readout, and the device dropdown's trigger content.
 *
 * Every field degrades on its own: no device info means model only, no stream
 * means no resolution, and anything other than `connected` drops the live
 * fields entirely rather than showing a stale reading.
 */
export const StatusChip = memo(function StatusChip({
    status,
    deviceName,
    deviceInfo,
    videoWidth = 0,
    videoHeight = 0,
    fps,
}: StatusChipProps) {
    const isConnected = status === 'connected';
    const primary = deviceInfo?.model || deviceName || (isConnected ? 'Device' : 'No device');

    // Not connected means no live fields at all, rather than a stale reading
    // left over from the stream that just ended.
    const state =
        status === 'connecting' ? 'Connecting…' : isConnected ? undefined : 'Not connected';
    const resolution = isConnected && videoWidth > 0 && videoHeight > 0;
    const battery = isConnected ? deviceInfo?.battery : undefined;

    return (
        <span className="status-chip">
            <span
                className={`device-status-dot status-chip-dot ${statusToDotClass(status)}`}
                aria-hidden="true"
            />
            <span className="status-chip-primary">{primary}</span>
            {/* Each field carries its own class so the breakpoints in
                toolbar.css can drop them in priority order. */}
            <span className="status-chip-meta">
                {state && <span className="status-chip-meta-item">{state}</span>}
                {resolution && (
                    <span className="status-chip-meta-item status-chip-resolution">
                        {videoWidth}×{videoHeight}
                    </span>
                )}
                {isConnected && fps && (
                    <span className="status-chip-meta-item status-chip-fps">{fps} fps</span>
                )}
                {battery && (
                    <span className="status-chip-meta-item" title="Battery level">
                        {battery.isCharging && (
                            <Zap size={9} className="status-chip-charging" aria-hidden="true" />
                        )}
                        {battery.level}%
                    </span>
                )}
            </span>
        </span>
    );
});
