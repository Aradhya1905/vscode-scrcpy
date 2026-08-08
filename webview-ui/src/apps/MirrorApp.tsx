import { useState, useCallback, useEffect, useRef } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { Toolbar, VideoCanvas, Placeholder, PhoneFrame, ZoomHud } from '../components';
import { useVSCodeMessages, useVideoDecoder, useSettingsStorage, useZoom } from '../hooks';
import type { ConnectionStatus, ExtensionMessage, DeviceListItem, ScrollEventData } from '../types';

export default function MirrorApp() {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [error, setError] = useState<string | undefined>();
    const [deviceList, setDeviceList] = useState<DeviceListItem[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
    // Remount key for the canvas - only the device skin toggle should remount it
    const [deviceSkinKey, setDeviceSkinKey] = useState(0);
    // Rect-cache invalidation counter - bumped by anything that moves the canvas
    const [canvasCacheKey, setCanvasCacheKey] = useState(0);
    const [isPanning, setIsPanning] = useState(false);

    // Load settings from storage
    const { settings, isLoaded, updateSetting, resetSettings } = useSettingsStorage();
    const showDeviceSkin = settings.showDeviceSkin ?? true;
    const persistentMirroring = settings.persistentMirroring ?? false;

    const handleZoomPersist = useCallback(
        (value: number) => {
            updateSetting('zoom', value);
        },
        [updateSetting]
    );

    const {
        zoom,
        panX,
        panY,
        isHudVisible,
        viewportRef,
        contentRef,
        zoomIn,
        zoomOut,
        resetZoom,
        zoomAtPoint,
        panBy,
        showHud,
        holdHud,
    } = useZoom({
        initialZoom: settings.zoom,
        isSettingsLoaded: isLoaded,
        onZoomChange: handleZoomPersist,
    });

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

            // Sent when the extension resumes forwarding after skipping frames. Clearing
            // the decoder makes it ignore the rest of the interrupted GOP and pick up
            // cleanly on the keyframe the extension just requested from the device.
            if (message.type === 'video-reset') {
                reset();
                return;
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

    // Keep extension behavior in sync with toolbar setting.
    useEffect(() => {
        if (!isLoaded) {
            return;
        }

        postMessage({
            command: 'set-persistent-mirroring',
            enabled: persistentMirroring,
        });
    }, [isLoaded, persistentMirroring, postMessage]);

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
                maxSize: parseInt(settings.quality || '0', 10),
                maxFps: parseInt(settings.fps || '60', 10),
                videoBitRate: parseInt(settings.bitrate || '8', 10) * 1_000_000,
            },
        });
    }, [addLog, reset, postMessage, settings.quality, settings.fps, settings.bitrate]);

    const handleStop = useCallback(() => {
        addLog('Stopping mirror...');
        postMessage({ command: 'stop' });
    }, [addLog, postMessage]);

    const handleRetry = useCallback(() => {
        addLog('Retrying connection...');
        // First stop any existing connection
        postMessage({ command: 'stop' });
        // Clear error and reset video decoder
        setError(undefined);
        reset();
        // Wait a bit before restarting to ensure clean stop
        setTimeout(() => {
            postMessage({
                command: 'start',
                settings: {
                    maxSize: parseInt(settings.quality || '0', 10),
                    maxFps: parseInt(settings.fps || '60', 10),
                    videoBitRate: parseInt(settings.bitrate || '8', 10) * 1_000_000,
                },
            });
        }, 300);
    }, [addLog, reset, postMessage, settings.quality, settings.fps, settings.bitrate]);

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

    const handlePasteText = useCallback(
        (text: string) => {
            postMessage({ command: 'paste', text });
        },
        [postMessage]
    );

    // Toolbar is wrapped in memo(), so every one of its callback props has to be
    // referentially stable or the memo boundary is defeated and the toolbar -
    // along with SettingsPanel/MorePanel behind it - reconciles on every render
    // of this component, including every frame of a pan drag.
    // See docs/changes/03-pan-rerender-perf.md
    const handleShowDeviceSkinChange = useCallback(
        (value: boolean) => updateSetting('showDeviceSkin', value),
        [updateSetting]
    );

    const handleGradientColor1Change = useCallback(
        (color1: string) => updateSetting('gradientColor1', color1),
        [updateSetting]
    );

    const handleGradientColor2Change = useCallback(
        (color2: string) => updateSetting('gradientColor2', color2),
        [updateSetting]
    );

    const handleDeviceSkinColorChange = useCallback(
        (color: string) => updateSetting('deviceSkinColor', color),
        [updateSetting]
    );

    const handleTouchFeedbackChange = useCallback(
        (enabled: boolean) => updateSetting('touchFeedback', enabled),
        [updateSetting]
    );

    const handleQualityChange = useCallback(
        (value: string) => updateSetting('quality', value),
        [updateSetting]
    );

    const handleFpsChange = useCallback(
        (value: string) => updateSetting('fps', value),
        [updateSetting]
    );

    const handleBitrateChange = useCallback(
        (value: string) => updateSetting('bitrate', value),
        [updateSetting]
    );

    const handleCursorStyleChange = useCallback(
        (value: 'crosshair' | 'default') => updateSetting('cursorStyle', value),
        [updateSetting]
    );

    const handlePersistentMirroringChange = useCallback(
        (enabled: boolean) => updateSetting('persistentMirroring', enabled),
        [updateSetting]
    );

    const handleResetSettings = useCallback(() => {
        resetSettings();
        resetZoom();
    }, [resetSettings, resetZoom]);

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

    // Remount the canvas when the device skin changes (video size changes with it)
    useEffect(() => {
        setDeviceSkinKey((prev) => prev + 1);
    }, [showDeviceSkin]);

    // Invalidate the canvas rect cache when the rendered geometry changes.
    // A CSS transform doesn't trigger the canvas ResizeObserver, so zoom must
    // invalidate explicitly or touch coordinates would use a stale rect.
    //
    // NOTE: this must NOT be the remount `key` - remounting mid-pan would tear
    // down the canvas the decoder is drawing into.
    //
    // panX/panY are deliberately NOT dependencies. They change on every
    // pointermove of a pan drag, and bumping state at that rate re-renders this
    // whole tree while the decoder is drawing. Pan doesn't need the
    // invalidation anyway: panning is bound to the middle mouse button and
    // sends no touch events, VideoCanvas re-reads the rect unconditionally on
    // every primary-button pointerdown, and its cached rect expires after
    // 100ms regardless. See docs/changes/03-pan-rerender-perf.md
    useEffect(() => {
        setCanvasCacheKey((prev) => prev + 1);
    }, [showDeviceSkin, zoom]);

    // Surface the zoom HUD briefly once the stream comes up, so it's discoverable
    useEffect(() => {
        if (isConnected) {
            showHud();
        }
    }, [isConnected, showHud]);

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
                ref={viewportRef}
                className={`video-container ${
                    !showDeviceSkin && isConnected ? 'no-device-skin' : ''
                } ${isPanning ? 'panning' : ''}`}
            >
                {isConnected ? (
                    <>
                        <div
                            ref={contentRef}
                            className="zoom-content"
                            style={{
                                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                            }}
                        >
                            {showDeviceSkin ? (
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
                                            onPasteText={handlePasteText}
                                            onLog={addLog}
                                            invalidateCacheKey={canvasCacheKey}
                                            touchEnabled={settings.touchFeedback !== false}
                                            onZoomWheel={zoomAtPoint}
                                            onPan={panBy}
                                            onPanStateChange={setIsPanning}
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
                                        onPasteText={handlePasteText}
                                        onLog={addLog}
                                        invalidateCacheKey={canvasCacheKey}
                                        touchEnabled={settings.touchFeedback !== false}
                                        onZoomWheel={zoomAtPoint}
                                        onPan={panBy}
                                        onPanStateChange={setIsPanning}
                                    />
                                </div>
                            )}
                        </div>
                        <ZoomHud
                            zoom={zoom}
                            isVisible={isHudVisible}
                            isPanned={panX !== 0 || panY !== 0}
                            onZoomIn={zoomIn}
                            onZoomOut={zoomOut}
                            onReset={resetZoom}
                            onHoldVisible={holdHud}
                            onReleaseVisible={showHud}
                        />
                    </>
                ) : (
                    <Placeholder
                        error={error}
                        isConnecting={status === 'connecting'}
                        onStart={error ? handleRetry : handleStart}
                    />
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
                onShowDeviceSkinChange={handleShowDeviceSkinChange}
                gradientColor1={settings.gradientColor1}
                gradientColor2={settings.gradientColor2}
                onGradientColor1Change={handleGradientColor1Change}
                onGradientColor2Change={handleGradientColor2Change}
                deviceSkinColor={settings.deviceSkinColor}
                onDeviceSkinColorChange={handleDeviceSkinColorChange}
                touchFeedback={settings.touchFeedback !== false}
                onTouchFeedbackChange={handleTouchFeedbackChange}
                quality={settings.quality}
                onQualityChange={handleQualityChange}
                fps={settings.fps}
                onFpsChange={handleFpsChange}
                bitrate={settings.bitrate}
                onBitrateChange={handleBitrateChange}
                cursorStyle={settings.cursorStyle}
                onCursorStyleChange={handleCursorStyleChange}
                onResetSettings={handleResetSettings}
                persistentMirroring={persistentMirroring}
                onPersistentMirroringChange={handlePersistentMirroringChange}
            />
        </>
    );
}
