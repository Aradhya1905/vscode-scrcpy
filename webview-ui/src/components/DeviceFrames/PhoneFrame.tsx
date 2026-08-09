import { ReactNode } from 'react';
import { SamsungS20Frame } from './SamsungS20Frame';

interface PhoneFrameProps {
    children: ReactNode;
    skinColor?: string;
    /** False hides the skin chrome without unmounting the frame (see SamsungS20Frame) */
    skinVisible?: boolean;
}

export function PhoneFrame({ children, skinColor, skinVisible }: PhoneFrameProps) {
    // Always use Samsung S20 frame as the default device skin
    return (
        <SamsungS20Frame skinColor={skinColor} skinVisible={skinVisible}>
            {children}
        </SamsungS20Frame>
    );
}
