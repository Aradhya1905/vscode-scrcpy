import { memo } from 'react';
import type { DeviceInfo } from '../types';

interface DeviceStatusProps {
    deviceInfo: DeviceInfo | null;
    isConnected: boolean;
}

export const DeviceStatus = memo(function DeviceStatus({
    deviceInfo,
    isConnected,
}: DeviceStatusProps) {
    if (!isConnected || !deviceInfo) {
        return (
            <div className="device-status">
                <div className="status-item">
                    <span className="status-text">Not connected</span>
                </div>
            </div>
        );
    }

    return (
        <div className="device-status">
            {/* Device Model */}
            <div
                className="status-item device-model"
                title={`${deviceInfo.model} - Android ${deviceInfo.androidVersion}`}
            >
                <span className="status-text">{deviceInfo.model}</span>
                <span className="status-text android-version">
                    Android {deviceInfo.androidVersion}
                </span>
            </div>
        </div>
    );
});
