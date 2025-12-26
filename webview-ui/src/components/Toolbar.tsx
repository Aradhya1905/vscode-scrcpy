import { useState, useEffect, memo } from 'react';
import {
    Smartphone,
    ChevronLeft,
    ChevronDown,
    Circle,
    Square,
    Play,
    Square as StopIcon,
    Camera,
    MoreVertical,
    Settings,
    RotateCw,
    Check,
} from 'lucide-react';
import type { ConnectionStatus, DeviceListItem } from '../types';
import { SettingsPanel } from './SettingsPanel';
import { MorePanel } from './MorePanel';
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
    toolbarPosition?: 'top' | 'bottom';
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
    toolbarPosition = 'bottom',
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

    const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
    const statusDotClass =
        status === 'connected'
            ? 'connected'
            : status === 'connecting'
              ? 'connecting'
              : 'disconnected';

    const handleDeviceSelect = (deviceId: string) => {
        onSelectDevice(deviceId);
        setShowDeviceDropdown(false);
    };

    return (
        <div className={`toolbar-container ${toolbarPosition === 'top' ? 'toolbar-at-top' : ''}`}>
            {/* Settings Panel */}
            {showSettingsPanel && (
                <SettingsPanel
                    onClose={() => setShowSettingsPanel(false)}
                    toolbarPosition={toolbarPosition}
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
                    onResetSettings={onResetSettings}
                />
            )}

            {/* More Panel */}
            {showMorePanel && (
                <MorePanel
                    onClose={() => setShowMorePanel(false)}
                    toolbarPosition={toolbarPosition}
                    screenOff={screenOff}
                    onScreenOffChange={setScreenOff}
                    showTouches={showTouches}
                    onShowTouchesChange={setShowTouches}
                    stayAwake={stayAwake}
                    onStayAwakeChange={setStayAwake}
                    darkMode={darkMode}
                    onDarkModeChange={setDarkMode}
                />
            )}

            <div className={`toolbar ${toolbarPosition === 'top' ? 'toolbar-at-top' : ''}`}>
                <div className="toolbar-row">
                    {/* Left: Device Selector */}
                    <div className="toolbar-group" style={{ flex: 1, minWidth: 50 }}>
                        <div className="device-selector">
                            <button
                                className="device-selector-btn"
                                onClick={() => {
                                    setShowDeviceDropdown(!showDeviceDropdown);
                                    setShowSettingsPanel(false);
                                    setShowMorePanel(false);
                                }}
                            >
                                <div className="device-info">
                                    <div className="device-icon" style={{ position: 'relative' }}>
                                        <Smartphone size={14} />
                                        <div
                                            className={`device-status-dot ${statusDotClass}`}
                                            style={{
                                                position: 'absolute',
                                                bottom: -2,
                                                right: -2,
                                                border: '2px solid var(--vsc-secondary)',
                                            }}
                                        />
                                    </div>
                                    <span className="device-name">
                                        {selectedDevice?.name || 'No Device'}
                                    </span>
                                </div>
                                <ChevronDown size={10} />
                            </button>

                            {/* Device Dropdown */}
                            {showDeviceDropdown && (
                                <div className="toolbar-device-dropdown">
                                    <div className="device-dropdown-header">
                                        <span className="device-dropdown-title">Devices</span>
                                        <button
                                            className="btn-icon"
                                            style={{ width: 28, height: 28 }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRefreshDevices();
                                            }}
                                            title="Scan for devices"
                                        >
                                            <RotateCw size={14} />
                                        </button>
                                    </div>
                                    <div className="device-list">
                                        {devices.length === 0 ? (
                                            <div
                                                style={{
                                                    padding: '20px',
                                                    textAlign: 'center',
                                                    color: 'var(--vsc-text-muted)',
                                                    fontSize: '12px',
                                                }}
                                            >
                                                No devices found
                                            </div>
                                        ) : (
                                            devices.map((device) => (
                                                <button
                                                    key={device.id}
                                                    className={`device-item ${
                                                        device.id === selectedDeviceId
                                                            ? 'selected'
                                                            : ''
                                                    }`}
                                                    onClick={() => handleDeviceSelect(device.id)}
                                                >
                                                    <div
                                                        className={`device-status-dot ${
                                                            device.status === 'device'
                                                                ? 'connected'
                                                                : 'disconnected'
                                                        }`}
                                                    />
                                                    <div className="device-item-info">
                                                        <div className="device-item-name">
                                                            {device.name}
                                                        </div>
                                                        <div className="device-item-id">
                                                            {device.id}
                                                        </div>
                                                    </div>
                                                    {device.id === selectedDeviceId && (
                                                        <Check size={14} color="var(--vsc-green)" />
                                                    )}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Center: Navigation Controls */}
                    <div className="toolbar-group" style={{ padding: '0 4px' }}>
                        <Tooltip
                            content="Back"
                            description="Navigate back on device"
                            icon={<ChevronLeft size={10} />}
                            iconColor="gray"
                        >
                            <button className="btn-icon" onClick={onBack} disabled={!isConnected}>
                                <ChevronLeft size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip
                            content="Home"
                            description="Go to home screen"
                            icon={<Circle size={8} />}
                            iconColor="gray"
                        >
                            <button className="btn-icon" onClick={onHome} disabled={!isConnected}>
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
                            >
                                <Square size={14} />
                            </button>
                        </Tooltip>
                    </div>

                    {/* Right: Actions */}
                    <div className="toolbar-group">
                        <Tooltip
                            content={isConnected ? 'Stop Mirroring' : 'Start Mirroring'}
                            description={
                                isConnected
                                    ? 'Stop screen mirroring session'
                                    : 'Begin screen mirroring session'
                            }
                            icon={isConnected ? <StopIcon size={10} /> : <Play size={10} />}
                            iconColor={isConnected ? 'red' : 'green'}
                            position="top"
                            align="right"
                        >
                            <button
                                className="btn-icon"
                                onClick={isConnected ? onStop : onStart}
                                disabled={isConnecting}
                                style={{
                                    color: isConnected ? 'var(--vsc-red)' : 'var(--vsc-green)',
                                }}
                            >
                                {isConnected ? <StopIcon size={14} /> : <Play size={14} />}
                            </button>
                        </Tooltip>
                        <Tooltip
                            content="Screenshot"
                            description="Capture device screen to clipboard"
                            icon={<Camera size={10} />}
                            iconColor="blue"
                            position="top"
                            align="right"
                        >
                            <button
                                className="btn-icon"
                                onClick={onScreenshot}
                                disabled={!isConnected}
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
                                onClick={() => {
                                    setShowMorePanel(!showMorePanel);
                                    setShowSettingsPanel(false);
                                    setShowDeviceDropdown(false);
                                }}
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
                                onClick={() => {
                                    setShowSettingsPanel(!showSettingsPanel);
                                    setShowMorePanel(false);
                                    setShowDeviceDropdown(false);
                                }}
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
