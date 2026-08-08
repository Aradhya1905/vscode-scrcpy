import { Usb } from 'lucide-react';

interface EmptyDevicesProps {
    onRescan: () => void;
}

/**
 * What a new user sees first. It used to be a line of centred body text with no
 * way out of it; the hint names the one setting that is almost always missing,
 * and Rescan is reachable without hunting for the small icon in the header.
 * See docs/changes/06-state-surfaces.md
 */
export function EmptyDevices({ onRescan }: EmptyDevicesProps) {
    return (
        <div className="empty-devices">
            <span className="empty-devices-glyph" aria-hidden="true">
                <Usb size={18} />
            </span>
            <div className="empty-devices-title">No devices found</div>
            <div className="empty-devices-hint">
                Enable USB debugging on the device, then rescan.
            </div>
            <button
                className="state-action state-action-block focus-ring"
                onClick={(event) => {
                    event.stopPropagation();
                    onRescan();
                }}
                type="button"
            >
                Rescan
            </button>
        </div>
    );
}
