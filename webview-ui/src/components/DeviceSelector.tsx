import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceListItem } from '../types';

type DropdownPlacement = 'auto' | 'up' | 'down';

interface DeviceSelectorProps {
    devices: DeviceListItem[];
    selectedDeviceId: string | null;
    onSelectDevice: (deviceId: string) => void;
    onRefresh: () => void;
    isLoading?: boolean;
    dropdownPlacement?: DropdownPlacement;
}

function statusToDotClass(status: DeviceListItem['status'] | undefined) {
    switch (status) {
        case 'device':
            return 'connected';
        case 'unauthorized':
            return 'connecting';
        case 'offline':
            return 'disconnected';
        default:
            return 'disconnected';
    }
}

function statusToLabel(status: DeviceListItem['status']) {
    switch (status) {
        case 'device':
            return 'Connected';
        case 'unauthorized':
            return 'Unauthorized';
        case 'offline':
            return 'Offline';
        default:
            return 'Unknown';
    }
}

export const DeviceSelector = memo(function DeviceSelector({
    devices,
    selectedDeviceId,
    onSelectDevice,
    onRefresh,
    isLoading = false,
    dropdownPlacement = 'auto',
}: DeviceSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const selectedDevice = useMemo(
        () => devices.find((d) => d.id === selectedDeviceId),
        [devices, selectedDeviceId]
    );

    useEffect(() => {
        if (!isOpen) return;
        onRefresh();
    }, [isOpen, onRefresh]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    const rootClass =
        dropdownPlacement === 'down'
            ? 'device-selector open-down'
            : dropdownPlacement === 'up'
              ? 'device-selector open-up'
              : 'device-selector';

    const buttonTitle = selectedDevice
        ? `${selectedDevice.name} (${selectedDevice.id})`
        : 'Select device';

    return (
        <div className={rootClass} ref={dropdownRef}>
            <button
                className="device-selector-btn focus-ring"
                onClick={() => setIsOpen((v) => !v)}
                disabled={isLoading}
                title={buttonTitle}
                type="button"
            >
                <span className="device-info">
                    <span
                        className={`device-status-dot ${statusToDotClass(selectedDevice?.status)}`}
                        aria-hidden="true"
                    />
                    <span className="device-name">
                        {selectedDevice ? selectedDevice.name : 'Select device'}
                    </span>
                </span>

                <svg
                    className={`device-selector-arrow ${isOpen ? 'open' : ''}`}
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                >
                    <path
                        d="M3 4.5 L6 7.5 L9 4.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>

            {isOpen && (
                <div className="device-dropdown" role="menu">
                    <div className="device-dropdown-header">
                        <span className="device-dropdown-title">Devices</span>
                        <button
                            className="device-dropdown-refresh focus-ring"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRefresh();
                            }}
                            title="Refresh device list"
                            type="button"
                        >
                            Refresh
                        </button>
                    </div>

                    {devices.length === 0 ? (
                        <div className="device-dropdown-empty">
                            <div className="device-dropdown-empty-title">No devices found</div>
                            <div className="device-dropdown-empty-hint">
                                Connect an Android device via USB and enable USB debugging.
                            </div>
                        </div>
                    ) : (
                        <div className="device-list">
                            {devices.map((device) => {
                                const isSelected = device.id === selectedDeviceId;
                                const disabled = device.status !== 'device';
                                return (
                                    <button
                                        key={device.id}
                                        className={`device-item ${isSelected ? 'selected' : ''} ${
                                            disabled ? 'disabled' : ''
                                        }`}
                                        onClick={() => {
                                            if (disabled) return;
                                            onSelectDevice(device.id);
                                            setIsOpen(false);
                                        }}
                                        disabled={disabled}
                                        title={`${device.name} • ${statusToLabel(device.status)} • ${device.id}`}
                                        type="button"
                                        role="menuitem"
                                    >
                                        <span className="device-item-info">
                                            <span className="device-item-name">{device.name}</span>
                                            <span className="device-item-id">{device.id}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});
