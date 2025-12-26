import { useState, useCallback, useEffect, useRef } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { Toolbar, VideoCanvas, Placeholder, PhoneFrame } from '../components';
import { useVSCodeMessages, useVideoDecoder, useSettingsStorage } from '../hooks';
import type { ConnectionStatus, ExtensionMessage, DeviceListItem, ScrollEventData } from '../types';

export default function MirrorApp() {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [error, setError] = useState<string | undefined>();
    const [deviceList, setDeviceList] = useState<DeviceListItem[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
    const [deviceSkinKey, setDeviceSkinKey] = useState(0);

    // Load settings from storage
    const { settings, isLoaded, updateSetting, resetSettings } = useSettingsStorage();
    const showDeviceSkin = settings.showDeviceSkin ?? true;

    const addLog = useCallback((_message: string, _level: 'info' | 'warn' | 'error' = 'info') => {
        // Logging disabled for performance
    }, []);

    const { setCanvas, processVideoPacket, reset, getVideoSize } = useVideoDecoder({
        onLog: addLog,
    });

    // Track status in a ref so video processing doesn't trigger re-render deps
    const statusRef = useRef(status);
    statusRef.current = status;

    // Use a ref to store postMessage to avoid circular dependency
    const postMessageRef = useRef<((msg: any) => void) | null>(null);

    const handleMessage = useCallback(
        (message: ExtensionMessage) => {
            // Process video outside React's batching for maximum performance
            // Use ref to avoid re-render dependency on status
            if (message.type === 'video') {
                if (statusRef.current === 'connected') {
                    processVideoPacket(message.data);
                }
                return; // Early return - video messages don't need state updates
            }

            // Use batched updates to prevent multiple re-renders
            unstable_batchedUpdates(() => {
                switch (message.type) {
                    case 'connecting':
                        setStatus('connecting');
                        break;

                    case 'connected':
                        setStatus('connected');
                        setError(undefined);
                        // Request device info after state update
                        setTimeout(() => {
                            postMessageRef.current?.({ command: 'get-device-info' });
                        }, 0);
                        break;

                    case 'disconnected':
                        setStatus('disconnected');
                        reset();
                        break;

                    case 'error':
                        setError(message.message);
                        break;

                    case 'device-info':
                        // Device info received but not used in new UI
                        break;

                    case 'device-list':
                        setDeviceList(message.devices);
                        break;

                    case 'device-selected':
                        setSelectedDeviceId(message.deviceId);
                        break;

                    case 'app-list':
                    case 'recent-apps':
                    case 'debug-apps':
                    case 'app-launched':
                    case 'fm-dir':
                        // Not used in mirror UI
                        break;
                }
            });
        },
        [processVideoPacket, reset]
    );

    const { postMessage } = useVSCodeMessages(handleMessage);

    // Store postMessage in ref for use in callbacks
    useEffect(() => {
        postMessageRef.current = postMessage;
    }, [postMessage]);

    // Request device list on mount
    useEffect(() => {
        postMessage({ command: 'get-device-list' });
    }, [postMessage]);

    const handleSelectDevice = useCallback(
        (deviceId: string) => {
            addLog(`Selecting device: ${deviceId}`);
            postMessage({ command: 'select-device', deviceId });
        },
        [addLog, postMessage]
    );

    const handleRefreshDevices = useCallback(() => {
        addLog('Refreshing device list...');
        postMessage({ command: 'get-device-list' });
    }, [addLog, postMessage]);

    const handleStart = useCallback(() => {
        addLog('Starting mirror...');
        setError(undefined);
        reset();
        // Send scrcpy settings with the start command
        postMessage({
            command: 'start',
            settings: {
                maxSize: parseInt(settings.quality || '1920', 10),
                maxFps: parseInt(settings.fps || '60', 10),
                videoBitRate: parseInt(settings.bitrate || '8', 10) * 1_000_000,
            },
        });
    }, [addLog, reset, postMessage, settings.quality, settings.fps, settings.bitrate]);

    const handleStop = useCallback(() => {
        addLog('Stopping mirror...');
        postMessage({ command: 'stop' });
    }, [addLog, postMessage]);

    const isConnected = status === 'connected';

    const handleHome = useCallback(() => {
        if (!isConnected) {
            addLog('Please start mirroring first', 'warn');
            return;
        }
        addLog('Home button pressed');
        postMessage({ command: 'home' });
    }, [isConnected, addLog, postMessage]);

    const handleBack = useCallback(() => {
        if (!isConnected) {
            addLog('Please start mirroring first', 'warn');
            return;
        }
        addLog('Back button pressed');
        postMessage({ command: 'back' });
    }, [isConnected, addLog, postMessage]);

    const handleAppView = useCallback(() => {
        if (!isConnected) {
            addLog('Please start mirroring first', 'warn');
            return;
        }
        addLog('App view button pressed');
        postMessage({ command: 'app-switch' });
    }, [isConnected, addLog, postMessage]);

    const handleScreenshot = useCallback(() => {
        if (!isConnected) {
            addLog('Please start mirroring first', 'warn');
            return;
        }
        addLog('Screenshot taken');
        postMessage({ command: 'screenshot' });
    }, [isConnected, addLog, postMessage]);

    const handleTouchEvent = useCallback(
        (
            action: 'down' | 'move' | 'up',
            x: number,
            y: number,
            videoWidth: number,
            videoHeight: number
        ) => {
            postMessage({
                command: 'touch',
                action,
                x,
                y,
                videoWidth,
                videoHeight,
            });
        },
        [postMessage]
    );

    const handleScrollEvent = useCallback(
        (
            x: number,
            y: number,
            deltaX: number,
            deltaY: number,
            videoWidth: number,
            videoHeight: number
        ) => {
            if (!isConnected) {
                addLog('Please start mirroring first', 'warn');
                return;
            }

            const message: ScrollEventData = {
                command: 'scroll',
                x,
                y,
                deltaX,
                deltaY,
                videoWidth,
                videoHeight,
            };

            postMessage(message);
        },
        [isConnected, addLog, postMessage]
    );

    const handleKeyEvent = useCallback(
        (action: 'down' | 'up', keyCode: number, metaState: number) => {
            postMessage({
                command: 'key',
                action,
                keyCode,
                metaState,
            });
        },
        [postMessage]
    );

    // Track previous device skin state to avoid restart on mount
    const prevDeviceSkinRef = useRef(showDeviceSkin);

    // Restart streaming when device skin is toggled
    useEffect(() => {
        // Only restart if device skin actually changed (not on initial mount)
        if (isConnected && prevDeviceSkinRef.current !== showDeviceSkin) {
            // Restart streaming to update video size
            addLog('Device skin changed, restarting stream...');
            handleStop();
            // Wait a bit before restarting to ensure clean stop
            const timer = setTimeout(() => {
                handleStart();
            }, 300);
            prevDeviceSkinRef.current = showDeviceSkin;
            return () => clearTimeout(timer);
        }
        prevDeviceSkinRef.current = showDeviceSkin;
    }, [showDeviceSkin, isConnected, handleStop, handleStart, addLog]);

    // Invalidate canvas cache when device skin changes
    useEffect(() => {
        setDeviceSkinKey((prev) => prev + 1);
    }, [showDeviceSkin]);

    // Update CSS variable for video container background gradient
    useEffect(() => {
        if (!isLoaded) return;

        if (showDeviceSkin || !isConnected) {
            // Use gradient when device skin is on OR when not connected
            const color1 = settings.gradientColor1 || 'rgba(238, 174, 202, 1)';
            const color2 = settings.gradientColor2 || 'rgba(148, 187, 233, 1)';
            const gradient = `radial-gradient(circle, ${color1} 0%, ${color2} 100%)`;
            document.documentElement.style.setProperty('--video-container-bg-gradient', gradient);
        } else {
            // Use black background when device skin is off AND streaming is active
            document.documentElement.style.setProperty(
                '--video-container-bg-gradient',
                'rgba(0, 0, 0, 1.0)'
            );
        }
    }, [isLoaded, isConnected, showDeviceSkin, settings.gradientColor1, settings.gradientColor2]);

    // Update CSS variable for cursor style
    useEffect(() => {
        if (!isLoaded) return;
        const cursor = settings.cursorStyle || 'crosshair';
        document.documentElement.style.setProperty('--video-canvas-cursor', cursor);
    }, [isLoaded, settings.cursorStyle]);

    return (
        <>
            <div
                className={`video-container ${
                    !showDeviceSkin && isConnected ? 'no-device-skin' : ''
                }`}
            >
                {isConnected ? (
                    showDeviceSkin ? (
                        <PhoneFrame
                            key={`phone-frame-${settings.deviceSkinColor || 'default'}`}
                            skinColor={settings.deviceSkinColor}
                        >
                            <div className="mirror-stage">
                                <VideoCanvas
                                    key={deviceSkinKey}
                                    isConnected={isConnected}
                                    canvasRef={setCanvas}
                                    getVideoSize={getVideoSize}
                                    onTouchEvent={handleTouchEvent}
                                    onScrollEvent={handleScrollEvent}
                                    onKeyEvent={handleKeyEvent}
                                    onLog={addLog}
                                    invalidateCacheKey={deviceSkinKey}
                                    touchEnabled={settings.touchFeedback !== false}
                                />
                            </div>
                        </PhoneFrame>
                    ) : (
                        <div className="mirror-stage">
                            <VideoCanvas
                                key={deviceSkinKey}
                                isConnected={isConnected}
                                canvasRef={setCanvas}
                                getVideoSize={getVideoSize}
                                onTouchEvent={handleTouchEvent}
                                onScrollEvent={handleScrollEvent}
                                onKeyEvent={handleKeyEvent}
                                onLog={addLog}
                                invalidateCacheKey={deviceSkinKey}
                                touchEnabled={settings.touchFeedback !== false}
                            />
                        </div>
                    )
                ) : (
                    <Placeholder error={error} isConnecting={status === 'connecting'} />
                )}
            </div>
            <Toolbar
                status={status}
                onStart={handleStart}
                onStop={handleStop}
                onHome={handleHome}
                onBack={handleBack}
                onAppView={handleAppView}
                onScreenshot={handleScreenshot}
                devices={deviceList}
                selectedDeviceId={selectedDeviceId}
                onSelectDevice={handleSelectDevice}
                onRefreshDevices={handleRefreshDevices}
                toolbarPosition="bottom"
                showDeviceSkin={showDeviceSkin}
                onShowDeviceSkinChange={(value) => updateSetting('showDeviceSkin', value)}
                gradientColor1={settings.gradientColor1}
                gradientColor2={settings.gradientColor2}
                onGradientColor1Change={(color1) => {
                    updateSetting('gradientColor1', color1);
                }}
                onGradientColor2Change={(color2) => {
                    updateSetting('gradientColor2', color2);
                }}
                deviceSkinColor={settings.deviceSkinColor}
                onDeviceSkinColorChange={(color) => {
                    updateSetting('deviceSkinColor', color);
                }}
                touchFeedback={settings.touchFeedback !== false}
                onTouchFeedbackChange={(enabled) => updateSetting('touchFeedback', enabled)}
                quality={settings.quality}
                onQualityChange={(value) => updateSetting('quality', value)}
                fps={settings.fps}
                onFpsChange={(value) => updateSetting('fps', value)}
                bitrate={settings.bitrate}
                onBitrateChange={(value) => updateSetting('bitrate', value)}
                cursorStyle={settings.cursorStyle}
                onCursorStyleChange={(value) => updateSetting('cursorStyle', value)}
                onResetSettings={resetSettings}
            />
        </>
    );
}
