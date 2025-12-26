import { ReactNode } from 'react';
import { SamsungS20Frame } from './SamsungS20Frame';

interface PhoneFrameProps {
    children: ReactNode;
    skinColor?: string;
}

export function PhoneFrame({ children, skinColor }: PhoneFrameProps) {
    // Always use Samsung S20 frame as the default device skin
    return <SamsungS20Frame skinColor={skinColor}>{children}</SamsungS20Frame>;
}
