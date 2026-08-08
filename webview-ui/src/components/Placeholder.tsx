import type { ConnectStage, DeviceInfo, DiagnosticResult } from '../types';
import { ConnectingState, ErrorState, IdleState } from './states';

interface PlaceholderProps {
    error?: string;
    isConnecting?: boolean;
    /** Which step of the connect the extension last reported */
    connectStage?: ConnectStage;
    deviceInfo?: DeviceInfo;
    deviceName?: string;
    /** Resolution decoded this session, 0 before any stream has run */
    lastVideoWidth?: number;
    lastVideoHeight?: number;
    diagnostic?: DiagnosticResult;
    isDiagnosticRunning?: boolean;
    onStart?: () => void;
    onRetry?: () => void;
    onCancel?: () => void;
    onCheckDevices?: () => void;
    onRestartAdbServer?: () => void;
    onTroubleshooting?: () => void;
}

/**
 * Router over the three pre-stream surfaces.
 *
 * Error wins over connecting: a failure reported mid-connect is the more
 * useful thing to show. See docs/changes/06-state-surfaces.md
 */
export function Placeholder({
    error,
    isConnecting,
    connectStage,
    deviceInfo,
    deviceName,
    lastVideoWidth,
    lastVideoHeight,
    diagnostic,
    isDiagnosticRunning,
    onStart,
    onRetry,
    onCancel,
    onCheckDevices,
    onRestartAdbServer,
    onTroubleshooting,
}: PlaceholderProps) {
    if (error) {
        return (
            <ErrorState
                error={error}
                diagnostic={diagnostic}
                isDiagnosticRunning={isDiagnosticRunning}
                onRetry={onRetry}
                onCheckDevices={onCheckDevices}
                onRestartAdbServer={onRestartAdbServer}
                onTroubleshooting={onTroubleshooting}
            />
        );
    }

    if (isConnecting) {
        return <ConnectingState stage={connectStage} onCancel={onCancel} />;
    }

    return (
        <IdleState
            deviceInfo={deviceInfo}
            deviceName={deviceName}
            lastVideoWidth={lastVideoWidth}
            lastVideoHeight={lastVideoHeight}
            onStart={onStart}
        />
    );
}
