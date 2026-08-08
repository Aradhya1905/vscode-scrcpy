import { useState, useCallback, useEffect, useRef } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { Toolbar, VideoCanvas, Placeholder, PhoneFrame, ZoomHud } from '../components';
import { useVSCodeMessages, useVideoDecoder, useSettingsStorage, useZoom } from '../hooks';
import type {
    ConnectionStatus,
    ConnectStage,
    DiagnosticResult,
    ExtensionMessage,
    DeviceInfo,
    DeviceListItem,
    ScrollEventData,
} from '../types';

export default function MirrorApp() {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [error, setError] = useState<string | undefined>();
    const [deviceList, setDeviceList] = useState<DeviceListItem[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
    // Status-chip inputs. Both change at most every few seconds - the device
    // info poll and a resolution change - never per frame.
    const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | undefined>();
    const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
    // Idle-state inputs. Unlike the two above these deliberately survive a
    // disconnect: the idle surface reports what was actually observed this
    // session, and clearing them would put it back to having nothing to say.
    const [lastDeviceInfo, setLastDeviceInfo] = useState<DeviceInfo | undefined>();
    const [lastVideoSize, setLastVideoSize] = useState({ width: 0, height: 0 });
    // Which step of the pending connect the extension last reported
    const [connectStage, setConnectStage] = useState<ConnectStage | undefined>();
    const [diagnostic, setDiagnostic] = useState<DiagnosticResult | undefined>();
    const [isDiagnosticRunning, setIsDiagnosticRunning] = useState(false);
    // Remount key for the canvas - only the device skin toggle should remount it
    const [deviceSkinKey, setDeviceSkinKey] = useState(0);
    // Rect-cache invalidation counter - bumped by anything that moves the canvas
    const [canvasCacheKey, setCanvasCacheKey] = useState(0);
    const [isPanning, setIsPanning] = useState(false);

    // Load settings from storage
    const { settings, isLoaded, updateSetting, resetSettings } = useSettingsStorage();
    const showDeviceSkin = settings.showDeviceSkin ?? true;
    const persistentMirroring = settings.persistentMirroring ?? false;
    const toolbarPosition = settings.toolbarPosition ?? 'bottom';

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

    // Fires on a real resolution change and on decoder reset, not per frame.
    const handleVideoSizeChange = useCallback((size: { width: number; height: number }) => {
        setVideoSize(size);
        // A reset pushes 0x0 through here; only a real size is worth keeping.
        if (size.width > 0 && size.height > 0) {
            setLastVideoSize(size);
        }
    }, []);

    const { setCanvas, processVideoPacket, reset, getVideoSize } = useVideoDecoder({
        onLog: addLog,
        onVideoSizeChange: handleVideoSizeChange,
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
                        // A fresh attempt starts with no stage and no stale
                        // diagnostic output from the previous failure.
                        setConnectStage(undefined);
                        setDiagnostic(undefined);
                        break;

                    case 'connect-progress':
                        setConnectStage(message.stage);
                        break;

                    case 'diagnostic-result':
                        setIsDiagnosticRunning(false);
                        setDiagnostic({
                            action: message.action,
                            success: message.success,
                            output: message.output,
                        });
                        break;

                    case 'connected':
                        setStatus('connected');
                        setError(undefined);
                        setConnectStage(undefined);
                        // Request device info after state update
                        setTimeout(() => {
                            postMessageRef.current?.({ command: 'get-device-info' });
                        }, 0);
                        break;

                    case 'disconnected':
                        setStatus('disconnected');
                        // Clear the status chip's live fields with the stream;
                        // reset() pushes the video size back to 0x0 itself.
                        setDeviceInfo(undefined);
                        setConnectStage(undefined);
                        reset();
                        break;

                    case 'error':
                        setError(message.message);
                        setConnectStage(undefined);
                        break;

                    case 'device-info':
                        setDeviceInfo(message.info);
                        setLastDeviceInfo(message.info);
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
        setDiagnostic(undefined);
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
        setDiagnostic(undefined);
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

    // Read-only ADB diagnostics offered from the error surface. Neither mutates
    // device state; both are things a user can already run in a terminal.
    // See docs/changes/06-state-surfaces.md
    const handleCheckDevices = useCallback(() => {
        setIsDiagnosticRunning(true);
        setDiagnostic(undefined);
        postMessage({ command: 'check-devices' });
    }, [postMessage]);

    const handleRestartAdbServer = useCallback(() => {
        setIsDiagnosticRunning(true);
        setDiagnostic(undefined);
        postMessage({ command: 'restart-adb-server' });
    }, [postMessage]);

    const handleTroubleshooting = useCallback(() => {
        postMessage({ command: 'open-troubleshooting' });
    }, [postMessage]);

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

    const handleToolbarPositionChange = useCallback(
        (position: 'top' | 'bottom') => updateSetting('toolbarPosition', position),
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
            // Use gradient when device skin is on OR when not connected.
            //
            // With no saved colours the backdrop is derived from the theme
            // (--backdrop-default in tokens.css) rather than the fixed pink and
            // periwinkle it used to hardcode. Saved colours still win, so
            // anyone who has picked a pair sees no change.
            const color1 = settings.gradientColor1;
            const color2 = settings.gradientColor2;
            const gradient =
                color1 && color2
                    ? `radial-gradient(circle, ${color1} 0%, ${color2} 100%)`
                    : 'var(--backdrop-default)';
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

    // Fallback name for the idle surface when no device info has arrived yet
    const selectedDeviceName = deviceList.find((d) => d.id === selectedDeviceId)?.name;

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
                        connectStage={connectStage}
                        deviceInfo={lastDeviceInfo}
                        deviceName={selectedDeviceName}
                        lastVideoWidth={lastVideoSize.width}
                        lastVideoHeight={lastVideoSize.height}
                        diagnostic={diagnostic}
                        isDiagnosticRunning={isDiagnosticRunning}
                        onStart={handleStart}
                        onRetry={handleRetry}
                        onCancel={handleStop}
                        onCheckDevices={handleCheckDevices}
                        onRestartAdbServer={handleRestartAdbServer}
                        onTroubleshooting={handleTroubleshooting}
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
                deviceInfo={deviceInfo}
                videoWidth={videoSize.width}
                videoHeight={videoSize.height}
                toolbarPosition={toolbarPosition}
                onToolbarPositionChange={handleToolbarPositionChange}
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
