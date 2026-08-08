import { useState, useEffect, useCallback, memo } from 'react';
import {
    ChevronLeft,
    Circle,
    Square,
    Play,
    Square as StopIcon,
    Camera,
    MoreVertical,
    Settings,
} from 'lucide-react';
import type { ConnectionStatus, DeviceInfo, DeviceListItem } from '../types';
import { useDismissable } from '../hooks/useDismissable';
import { SettingsPanel } from './SettingsPanel';
import { MorePanel } from './MorePanel';
import { StatusChip } from './StatusChip';
import { DeviceSelector } from './DeviceSelector';
import { Tooltip } from './Tooltip';

interface ToolbarProps {
    status: ConnectionStatus;
    onStart: () => void;
    onStop: () => void;
    onHome?: () => void;
    onBack?: () => void;
    onAppView?: () => void;
    onScreenshot?: () => void;
    devices: DeviceListItem[];
    selectedDeviceId: string | null;
    onSelectDevice: (deviceId: string) => void;
    onRefreshDevices: () => void;
    deviceInfo?: DeviceInfo;
    videoWidth?: number;
    videoHeight?: number;
    toolbarPosition?: 'top' | 'bottom';
    onToolbarPositionChange?: (position: 'top' | 'bottom') => void;
    showDeviceSkin?: boolean;
    onShowDeviceSkinChange?: (show: boolean) => void;
    gradientColor1?: string;
    gradientColor2?: string;
    onGradientColor1Change?: (color1: string) => void;
    onGradientColor2Change?: (color2: string) => void;
    deviceSkinColor?: string;
    onDeviceSkinColorChange?: (color: string) => void;
    touchFeedback?: boolean;
    onTouchFeedbackChange?: (enabled: boolean) => void;
    quality?: string;
    onQualityChange?: (quality: string) => void;
    fps?: string;
    onFpsChange?: (fps: string) => void;
    bitrate?: string;
    onBitrateChange?: (bitrate: string) => void;
    cursorStyle?: 'crosshair' | 'default';
    onCursorStyleChange?: (style: 'crosshair' | 'default') => void;
    onResetSettings?: () => void;
    persistentMirroring?: boolean;
    onPersistentMirroringChange?: (enabled: boolean) => void;
}

export const Toolbar = memo(function Toolbar({
    status,
    onStart,
    onStop,
    onHome,
    onBack,
    onAppView,
    onScreenshot,
    devices,
    selectedDeviceId,
    onSelectDevice,
    onRefreshDevices,
    deviceInfo,
    videoWidth,
    videoHeight,
    toolbarPosition = 'bottom',
    onToolbarPositionChange,
    showDeviceSkin,
    onShowDeviceSkinChange,
    gradientColor1,
    gradientColor2,
    onGradientColor1Change,
    onGradientColor2Change,
    deviceSkinColor,
    onDeviceSkinColorChange,
    touchFeedback,
    onTouchFeedbackChange,
    quality,
    onQualityChange,
    fps,
    onFpsChange,
    bitrate,
    onBitrateChange,
    cursorStyle,
    onCursorStyleChange,
    onResetSettings,
    persistentMirroring = false,
    onPersistentMirroringChange,
}: ToolbarProps) {
    const isConnected = status === 'connected';
    const isConnecting = status === 'connecting';
    const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
    const [showSettingsPanel, setShowSettingsPanel] = useState(false);
    const [showMorePanel, setShowMorePanel] = useState(false);

    // Quick control toggle states (persisted in Toolbar so they survive panel close/open)
    const [screenOff, setScreenOff] = useState(false);
    const [showTouches, setShowTouches] = useState(false);
    const [stayAwake, setStayAwake] = useState(false);
    const [darkMode, setDarkMode] = useState(false);

    // Reset screen off state when streaming stops
    useEffect(() => {
        const handler = (event: MessageEvent<any>) => {
            const msg = event.data;
            if (msg?.type === 'disconnected') {
                setScreenOff(false);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    const closePanels = useCallback(() => {
        setShowSettingsPanel(false);
        setShowMorePanel(false);
    }, []);

    const closeSettingsPanel = useCallback(() => setShowSettingsPanel(false), []);
    const closeMorePanel = useCallback(() => setShowMorePanel(false), []);

    // The dropdown and the two panels overlap the same space, so exactly one of
    // the three may be open. The dropdown is controlled from here for that
    // reason; elsewhere DeviceSelector still owns its own open state.
    const toggleSettingsPanel = useCallback(() => {
        setShowDeviceDropdown(false);
        setShowMorePanel(false);
        setShowSettingsPanel((open) => !open);
    }, []);

    const toggleMorePanel = useCallback(() => {
        setShowDeviceDropdown(false);
        setShowSettingsPanel(false);
        setShowMorePanel((open) => !open);
    }, []);

    const handleDeviceDropdownChange = useCallback((open: boolean) => {
        setShowDeviceDropdown(open);
        if (open) {
            setShowSettingsPanel(false);
            setShowMorePanel(false);
        }
    }, []);

    // Scoped to the whole toolbar so a pointerdown on the video closes the
    // panel, while a second click on the trigger button still just toggles.
    const isPanelOpen = showSettingsPanel || showMorePanel;
    const toolbarRef = useDismissable<HTMLDivElement>(isPanelOpen, closePanels);

    const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
    const primaryLabel = isConnected ? 'Stop Mirroring' : 'Start Mirroring';

    return (
        <div
            ref={toolbarRef}
            className={`toolbar-container ${toolbarPosition === 'top' ? 'toolbar-at-top' : ''}`}
        >
            {/* Settings Panel */}
            {showSettingsPanel && (
                <SettingsPanel
                    onClose={closeSettingsPanel}
                    toolbarPosition={toolbarPosition}
                    onToolbarPositionChange={onToolbarPositionChange}
                    showDeviceSkin={showDeviceSkin}
                    onShowDeviceSkinChange={onShowDeviceSkinChange}
                    gradientColor1={gradientColor1}
                    gradientColor2={gradientColor2}
                    onGradientColor1Change={onGradientColor1Change}
                    onGradientColor2Change={onGradientColor2Change}
                    deviceSkinColor={deviceSkinColor}
                    onDeviceSkinColorChange={onDeviceSkinColorChange}
                    touchFeedback={touchFeedback}
                    onTouchFeedbackChange={onTouchFeedbackChange}
                    quality={quality}
                    onQualityChange={onQualityChange}
                    fps={fps}
                    onFpsChange={onFpsChange}
                    bitrate={bitrate}
                    onBitrateChange={onBitrateChange}
                    cursorStyle={cursorStyle}
                    onCursorStyleChange={onCursorStyleChange}
                    persistentMirroring={persistentMirroring}
                    onPersistentMirroringChange={onPersistentMirroringChange}
                    onResetSettings={onResetSettings}
                />
            )}

            {/* More Panel */}
            {showMorePanel && (
                <MorePanel
                    onClose={closeMorePanel}
                    toolbarPosition={toolbarPosition}
                    screenOff={screenOff}
                    onScreenOffChange={setScreenOff}
                    showTouches={showTouches}
                    onShowTouchesChange={setShowTouches}
                    stayAwake={stayAwake}
                    onStayAwakeChange={setStayAwake}
                    darkMode={darkMode}
                    onDarkModeChange={setDarkMode}
                    navEnabled={isConnected}
                    onBack={onBack}
                    onHome={onHome}
                    onAppView={onAppView}
                />
            )}

            <div className={`toolbar ${toolbarPosition === 'top' ? 'toolbar-at-top' : ''}`}>
                {/* Row 1: status readout, which doubles as the device picker */}
                <div className="toolbar-row toolbar-row-status">
                    <DeviceSelector
                        devices={devices}
                        selectedDeviceId={selectedDeviceId}
                        onSelectDevice={onSelectDevice}
                        onRefresh={onRefreshDevices}
                        isOpen={showDeviceDropdown}
                        onOpenChange={handleDeviceDropdownChange}
                        dropdownPlacement={toolbarPosition === 'top' ? 'down' : 'up'}
                        triggerClassName="status-chip-trigger"
                        triggerLabel="Device and connection status"
                        triggerContent={
                            <StatusChip
                                status={status}
                                deviceName={selectedDevice?.name}
                                deviceInfo={deviceInfo}
                                videoWidth={videoWidth}
                                videoHeight={videoHeight}
                                fps={fps}
                            />
                        }
                    />
                </div>

                {/* Row 2: navigation, the primary action, then secondary actions */}
                <div className="toolbar-row toolbar-row-controls">
                    <div className="toolbar-group toolbar-nav">
                        <Tooltip
                            content="Back"
                            description="Navigate back on device"
                            icon={<ChevronLeft size={10} />}
                            iconColor="gray"
                        >
                            <button
                                className="btn-icon"
                                onClick={onBack}
                                disabled={!isConnected}
                                aria-label="Back"
                            >
                                <ChevronLeft size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip
                            content="Home"
                            description="Go to home screen"
                            icon={<Circle size={8} />}
                            iconColor="gray"
                        >
                            <button
                                className="btn-icon"
                                onClick={onHome}
                                disabled={!isConnected}
                                aria-label="Home"
                            >
                                <Circle size={10} />
                            </button>
                        </Tooltip>
                        <Tooltip
                            content="Recent Apps"
                            description="View recent applications"
                            icon={<Square size={10} />}
                            iconColor="gray"
                        >
                            <button
                                className="btn-icon"
                                onClick={onAppView}
                                disabled={!isConnected}
                                aria-label="Recent apps"
                            >
                                <Square size={14} />
                            </button>
                        </Tooltip>
                    </div>

                    <Tooltip
                        content={primaryLabel}
                        description={
                            isConnected
                                ? 'Stop screen mirroring session'
                                : 'Begin screen mirroring session'
                        }
                        icon={isConnected ? <StopIcon size={10} /> : <Play size={10} />}
                        iconColor={isConnected ? 'red' : 'green'}
                        position="top"
                    >
                        <button
                            className={`btn-primary-pill ${isConnected ? 'is-stop' : 'is-start'}`}
                            onClick={isConnected ? onStop : onStart}
                            disabled={isConnecting}
                            aria-label={primaryLabel}
                        >
                            {isConnected ? <StopIcon size={13} /> : <Play size={13} />}
                            <span className="btn-primary-pill-label">
                                {isConnecting ? 'Starting…' : isConnected ? 'Stop' : 'Start'}
                            </span>
                        </button>
                    </Tooltip>

                    <div className="toolbar-group toolbar-actions">
                        <Tooltip
                            content="Screenshot"
                            description="Save device screen as PNG"
                            icon={<Camera size={10} />}
                            iconColor="blue"
                            position="top"
                            align="right"
                        >
                            <button
                                className="btn-icon"
                                onClick={onScreenshot}
                                disabled={!isConnected}
                                aria-label="Screenshot"
                            >
                                <Camera size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip
                            content="More Options"
                            description="APK install & additional tools"
                            icon={<MoreVertical size={10} />}
                            iconColor="blue"
                            position="top"
                            align="right"
                        >
                            <button
                                className="btn-icon"
                                onClick={toggleMorePanel}
                                aria-label="More options"
                                aria-expanded={showMorePanel}
                                aria-haspopup="dialog"
                            >
                                <MoreVertical size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip
                            content="Settings"
                            description="Configure quality, FPS & audio options"
                            icon={<Settings size={10} />}
                            iconColor="gray"
                            position="top"
                            align="right"
                        >
                            <button
                                className="btn-icon"
                                onClick={toggleSettingsPanel}
                                aria-label="Settings"
                                aria-expanded={showSettingsPanel}
                                aria-haspopup="dialog"
                            >
                                <Settings size={14} />
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
});
