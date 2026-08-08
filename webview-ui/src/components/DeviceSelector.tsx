import { memo, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useDismissable } from '../hooks/useDismissable';
import { EmptyDevices } from './states';
import type { DeviceListItem } from '../types';

type DropdownPlacement = 'auto' | 'up' | 'down';

interface DeviceSelectorProps {
    devices: DeviceListItem[];
    selectedDeviceId: string | null;
    onSelectDevice: (deviceId: string) => void;
    onRefresh: () => void;
    isLoading?: boolean;
    dropdownPlacement?: DropdownPlacement;
    /**
     * Replaces the default dot + name trigger content. The mirror view passes
     * its status chip here so there is one device picker, not two.
     */
    triggerContent?: ReactNode;
    /** Extra class on the trigger button, for callers that restyle it */
    triggerClassName?: string;
    /** Accessible name for the trigger; falls back to the device summary */
    triggerLabel?: string;
    /**
     * Controlled open state. Omit to let the component own it; pass it when the
     * caller has sibling overlays that must not be open at the same time.
     */
    isOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
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
    triggerContent,
    triggerClassName,
    triggerLabel,
    isOpen: controlledIsOpen,
    onOpenChange,
}: DeviceSelectorProps) {
    const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false);
    const isOpen = controlledIsOpen ?? uncontrolledIsOpen;
    const dropdownId = useId();

    const setOpen = useCallback(
        (next: boolean) => {
            if (controlledIsOpen === undefined) {
                setUncontrolledIsOpen(next);
            }
            onOpenChange?.(next);
        },
        [controlledIsOpen, onOpenChange]
    );

    const close = useCallback(() => setOpen(false), [setOpen]);
    // The ref goes on the wrapper, which holds the trigger as well as the
    // dropdown - otherwise clicking the trigger to close would immediately
    // re-open it from the button's own handler.
    const dropdownRef = useDismissable<HTMLDivElement>(isOpen, close);

    const selectedDevice = useMemo(
        () => devices.find((d) => d.id === selectedDeviceId),
        [devices, selectedDeviceId]
    );

    useEffect(() => {
        if (!isOpen) return;
        onRefresh();
    }, [isOpen, onRefresh]);

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
                className={`device-selector-btn focus-ring${
                    triggerClassName ? ` ${triggerClassName}` : ''
                }`}
                onClick={() => setOpen(!isOpen)}
                disabled={isLoading}
                title={buttonTitle}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-controls={isOpen ? dropdownId : undefined}
                aria-label={triggerLabel ?? buttonTitle}
            >
                {triggerContent ?? (
                    <span className="device-info">
                        <span
                            className={`device-status-dot ${statusToDotClass(
                                selectedDevice?.status
                            )}`}
                            aria-hidden="true"
                        />
                        <span className="device-name">
                            {selectedDevice ? selectedDevice.name : 'Select device'}
                        </span>
                    </span>
                )}

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
                <div className="device-dropdown" id={dropdownId}>
                    <div className="device-dropdown-header">
                        <span className="device-dropdown-title">Devices</span>
                        <button
                            className="device-dropdown-refresh focus-ring"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRefresh();
                            }}
                            title="Refresh device list"
                            aria-label="Refresh device list"
                            type="button"
                        >
                            Refresh
                        </button>
                    </div>

                    <div className="device-list" role="listbox" aria-label="Devices">
                        {devices.length === 0 ? (
                            <EmptyDevices onRescan={onRefresh} />
                        ) : (
                            devices.map((device) => {
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
                                            close();
                                        }}
                                        disabled={disabled}
                                        title={`${device.name} • ${statusToLabel(device.status)} • ${device.id}`}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                    >
                                        <span className="device-item-info">
                                            <span className="device-item-name">{device.name}</span>
                                            <span className="device-item-id">{device.id}</span>
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});
