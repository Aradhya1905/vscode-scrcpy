import { ReactNode } from 'react';

interface SamsungS20FrameProps {
    children: ReactNode;
    skinColor?: string;
}

export function SamsungS20Frame({ children, skinColor = '#1a1a1a' }: SamsungS20FrameProps) {
    return (
        <div className="samsung-s20-frame" style={{ color: skinColor }}>
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
