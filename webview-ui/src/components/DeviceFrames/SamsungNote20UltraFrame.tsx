import { ReactNode } from 'react';

interface SamsungNote20UltraFrameProps {
    children: ReactNode;
    skinColor?: string;
}

export function SamsungNote20UltraFrame({
    children,
    skinColor = '#1a1a1a',
}: SamsungNote20UltraFrameProps) {
    return (
        <div className="samsung-note20ultra-frame" style={{ color: skinColor }}>
            <div className="samsung-note20ultra-screen">
                {/* Punch-hole camera in top-center */}
                <div className="samsung-note20ultra-camera-cutout" />

                {/* Active Screen - Video Content */}
                <div className="samsung-note20ultra-active-screen">{children}</div>

                {/* S Pen slot on bottom */}
                <div className="samsung-note20ultra-spen-slot" />

                {/* Power button on right side */}
                <div className="samsung-note20ultra-button-right" />
                <div className="samsung-note20ultra-button-right-volume" />
            </div>
        </div>
    );
}
