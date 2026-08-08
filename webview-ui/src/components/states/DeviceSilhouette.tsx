import type { ReactNode } from 'react';

interface DeviceSilhouetteProps {
    children: ReactNode;
}

/**
 * The decorative phone frame the pre-stream surfaces sit inside.
 *
 * Kept for idle and connecting only, where the silhouette reads as "your device
 * goes here". The error surface deliberately drops it - a phone frame around an
 * error message makes the error look like device output.
 * See docs/changes/06-state-surfaces.md
 */
export function DeviceSilhouette({ children }: DeviceSilhouetteProps) {
    return (
        <div className="phone-frame">
            <div className="phone-screen">
                <div className="phone-notch">
                    <div className="phone-notch-dot" />
                </div>

                {children}

                <div className="phone-button-right" style={{ top: 80, height: 40 }} />
                <div className="phone-button-right" style={{ top: 128, height: 24 }} />
                <div className="phone-button-left" style={{ top: 112, height: 48 }} />
            </div>
        </div>
    );
}
