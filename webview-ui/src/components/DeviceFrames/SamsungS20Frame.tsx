import { ReactNode } from 'react';

interface SamsungS20FrameProps {
    children: ReactNode;
    skinColor?: string;
    /**
     * When false the frame collapses to a plain full-size box. It stays mounted so
     * the video canvas keeps its DOM identity (and the running stream) across toggles.
     */
    skinVisible?: boolean;
}

export function SamsungS20Frame({
    children,
    skinColor = '#1a1a1a',
    skinVisible = true,
}: SamsungS20FrameProps) {
    return (
        <div
            className={`samsung-s20-frame${skinVisible ? '' : ' skin-hidden'}`}
            style={{ color: skinColor }}
        >
            <div className="samsung-s20-screen">
                {/* Punch-hole camera in top-center */}
                <div className="samsung-s20-camera-cutout" />

                {/* Active Screen - Video Content */}
                <div className="samsung-s20-active-screen">{children}</div>

                {/* Power button on right side */}
                <div className="samsung-s20-button-right" />
                <div className="samsung-s20-button-right-volume" />
            </div>
        </div>
    );
}
