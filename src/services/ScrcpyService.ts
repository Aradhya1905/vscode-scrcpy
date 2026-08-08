import * as fs from 'fs';
import * as path from 'path';
import { Adb, AdbServerClient } from '@yume-chan/adb';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import {
    AndroidKeyCode,
    AndroidKeyEventAction,
    AndroidKeyEventMeta,
    AndroidMotionEventAction,
    AndroidMotionEventButton,
    AndroidScreenPowerMode,
    ScrcpyCodecOptions,
    ScrcpyControlMessageWriter,
    ScrcpyMediaStreamPacket,
} from '@yume-chan/scrcpy';
import { ReadableStream } from '@yume-chan/stream-extra';
import type { ScrcpyVideoPacket } from './VideoFrameForwarder';

export interface ScrcpyServiceEvents {
    onVideoPacket: (packet: ScrcpyVideoPacket) => void;
    onError: (error: string) => void;
    onConnected: () => void;
    onDisconnected: () => void;
}

export interface ScrcpySettings {
    maxSize?: number;
    maxFps?: number;
    videoBitRate?: number;
}

export class ScrcpyService {
    /** How long the video stream may go quiet before the watchdog reports a stall. */
    private static readonly VIDEO_STALL_TIMEOUT_MS = 10000;

    private adbClient: AdbServerClient | null = null;
    private adb: Adb | null = null;
    private scrcpyClient: AdbScrcpyClient<AdbScrcpyOptions3_3_3<true>> | null = null;
    private controller: ScrcpyControlMessageWriter | null = null;
    private isRunning = false;
    private events: ScrcpyServiceEvents;
    private currentDeviceId: string | null = null;
    private videoWidth = 0;
    private videoHeight = 0;
    private extensionPath: string;
    private settings: ScrcpySettings = {};
    private streamAbortController: AbortController | null = null;
    private ptsBase: number | null = null;
    private lastPts = 0;

    constructor(events: ScrcpyServiceEvents, extensionPath: string) {
        this.events = events;
        this.extensionPath = extensionPath;
    }

    async start(deviceId?: string | null, settings?: ScrcpySettings): Promise<void> {
        if (this.isRunning) {
            this.events.onError('Scrcpy is already running');
            return;
        }

        // Store settings for use in startScrcpy
        this.settings = settings || {};

        try {
            // Step 1: Connect to ADB server
            const connector = new AdbServerNodeTcpConnector({
                host: '127.0.0.1',
                port: 5037,
            });
            this.adbClient = new AdbServerClient(connector);

            // Step 2: Get device list and select device
            const devices = await this.adbClient.getDevices();

            let selectedDevice = devices.find((d) => d.state === 'device');
            if (deviceId) {
                selectedDevice = devices.find((d) => d.serial === deviceId && d.state === 'device');
            }

            if (!selectedDevice) {
                this.events.onError(
                    'No Android device found. Ensure USB debugging is enabled in Developer Options and authorize the connection on your device.'
                );
                return;
            }

            this.currentDeviceId = selectedDevice.serial;

            // Step 3: Create ADB connection to device
            this.adb = await this.adbClient.createAdb(selectedDevice);

            // Step 4: Push scrcpy server to device
            await this.pushServer();

            // Set running flag BEFORE starting scrcpy so video stream loop works
            this.isRunning = true;

            // Step 5: Start scrcpy
            await this.startScrcpy();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Failed to start scrcpy:', errorMessage);
            this.events.onError(`Failed to start scrcpy: ${errorMessage}`);
            this.stop();
        }
    }

    private async pushServer(): Promise<void> {
        if (!this.adb) {
            throw new Error('ADB not connected');
        }

        // Read the server file from assets folder (cross-platform)
        const serverPath = path.join(this.extensionPath, 'assets', 'scrcpy-server');
        const serverBuffer = fs.readFileSync(serverPath);

        // Create a ReadableStream from the buffer
        const serverStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(serverBuffer));
                controller.close();
            },
        });

        await AdbScrcpyClient.pushServer(this.adb, serverStream);
    }

    private async startScrcpy(): Promise<void> {
        if (!this.adb) {
            throw new Error('ADB not connected');
        }

        // Use settings or defaults
        const maxSize = this.settings.maxSize || 0;
        const maxFps = this.settings.maxFps || 60;
        const videoBitRate = this.settings.videoBitRate || 8_000_000;

        // Create scrcpy options for version 3.3.3
        const options = new AdbScrcpyOptions3_3_3({
            video: true,
            audio: false,
            control: true,
            cleanup: true,
            maxSize: maxSize,
            videoBitRate: videoBitRate,
            maxFps: maxFps,
            videoCodec: 'h264',
            tunnelForward: false,
            sendDeviceMeta: true,
            sendFrameMeta: true,
            sendDummyByte: true,
            sendCodecMeta: true,
            // Low-latency codec options
            videoCodecOptions: new ScrcpyCodecOptions({
                maxBframes: 0,
            }),
        });

        // Start scrcpy client
        this.scrcpyClient = await AdbScrcpyClient.start(
            this.adb,
            '/data/local/tmp/scrcpy-server.jar',
            options
        );

        // Get controller for sending input
        this.controller = this.scrcpyClient.controller ?? null;

        // Handle video stream
        if (this.scrcpyClient.videoStream) {
            const videoStream = await this.scrcpyClient.videoStream;

            // Get initial video size
            this.videoWidth = videoStream.width;
            this.videoHeight = videoStream.height;

            // Subscribe to size changes
            videoStream.sizeChanged((size: { width: number; height: number }) => {
                this.videoWidth = size.width;
                this.videoHeight = size.height;
            });

            // Notify connected
            this.events.onConnected();

            // Process video packets
            this.processVideoStream(videoStream.stream);
        }

        // Handle output messages
        this.processOutputMessages();

        // Handle client exit
        this.scrcpyClient.exited
            .then(() => {
                if (this.isRunning) {
                    this.events.onDisconnected();
                    this.isRunning = false;
                }
            })
            .catch((error) => {
                console.error('Scrcpy client error:', error);
            });
    }

    private async processVideoStream(
        stream: ReadableStream<ScrcpyMediaStreamPacket>
    ): Promise<void> {
        // Create abort controller for this stream session
        this.streamAbortController = new AbortController();
        const abortSignal = this.streamAbortController.signal;

        this.ptsBase = null;
        this.lastPts = 0;

        const reader = stream.getReader();

        // The stream is a native WHATWG ReadableStream, so cancel() settles any
        // in-flight read() with { done: true }. That ends the loop below without
        // racing a timeout Promise against the read - which is what previously
        // left an orphaned read pending, swallowing the next packet (a config or
        // IDR loss froze the picture for a whole GOP).
        const cancelRead = () => {
            reader.cancel().catch(() => {
                // Already closed or errored; nothing to unwind.
            });
        };

        // One timer for the whole session, rearmed with refresh() per packet
        // instead of allocating a Promise + closure + timeout + listener pair
        // every read. A gap is not an error: with the screen off scrcpy sends
        // nothing for as long as the display stays static, so the watchdog only
        // reports the stall and leaves the stream open to resume. setTimeout is
        // one-shot, so this logs once per gap rather than every interval.
        const stallTimer = setTimeout(() => {
            if (this.isRunning) {
                console.warn(
                    `No video packets for ${ScrcpyService.VIDEO_STALL_TIMEOUT_MS}ms; stream idle`
                );
            }
        }, ScrcpyService.VIDEO_STALL_TIMEOUT_MS);

        try {
            if (abortSignal.aborted) {
                cancelRead();
            } else {
                abortSignal.addEventListener('abort', cancelRead, { once: true });
            }

            while (this.isRunning) {
                const { done, value } = await reader.read();
                if (done || !value) {
                    break;
                }

                stallTimer.refresh();

                if (!value.data || value.data.length === 0) {
                    continue;
                }

                // value.data is a subarray view into the shared socket read buffer,
                // so it has to be copied synchronously here and can never be
                // retained. A plain Uint8Array rather than Buffer.from: Buffer
                // allocates from a shared pool, whose .buffer is a slab far larger
                // than the packet, and the forwarder posts .buffer directly.
                const data = new Uint8Array(value.data.length);
                data.set(value.data);

                if (value.type === 'configuration') {
                    this.events.onVideoPacket({ type: 'config', data });
                    continue;
                }

                // The keyframe flag and pts travel with the packet: the forwarder
                // needs the flag to know where a dropped stream may resume, and the
                // webview needs the real timestamp instead of synthesizing one from
                // arrival time.
                this.events.onVideoPacket({
                    type: 'frame',
                    data,
                    keyframe: value.keyframe === true,
                    pts: this.rebasePts(value.pts),
                });
            }
        } catch (error) {
            if (this.isRunning) {
                console.error('Error processing video stream:', error);
            }
        } finally {
            clearTimeout(stallTimer);
            abortSignal.removeEventListener('abort', cancelRead);

            // Release the reader lock
            try {
                reader.releaseLock();
            } catch {
                // Ignore if already released
            }

            this.streamAbortController = null;
        }
    }

    /**
     * Device presentation timestamps, as plain microsecond numbers relative to the
     * first frame of the session.
     *
     * Two reasons not to forward the raw value: a bigint is not cloneable through
     * VS Code's postMessage path, and `resetVideo()` restarts the encoder, which can
     * restart its timestamps too. A backwards timestamp makes the decoder reject the
     * chunk, so the series is rebased on any jump and forced to keep increasing.
     */
    private rebasePts(pts: bigint | undefined): number {
        if (pts === undefined) {
            // No frame metadata; advance by a nominal frame so the series still moves.
            this.lastPts += 1000;
            return this.lastPts;
        }

        const micros = Number(pts);
        if (this.ptsBase === null || micros < this.ptsBase) {
            this.ptsBase = micros - this.lastPts;
        }

        const rebased = micros - this.ptsBase;
        this.lastPts = rebased > this.lastPts ? rebased : this.lastPts + 1;
        return this.lastPts;
    }

    private async processOutputMessages(): Promise<void> {
        if (!this.scrcpyClient) return;

        try {
            const reader = this.scrcpyClient.output.getReader();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                // Process output if needed
            }
        } catch (error) {
            console.error('Error processing output:', error);
        }
    }

    sendTouchEvent(
        action: string,
        x: number,
        y: number,
        videoWidth: number,
        videoHeight: number
    ): void {
        if (!this.controller) {
            console.warn('Controller not connected');
            return;
        }

        try {
            let androidAction: (typeof AndroidMotionEventAction)[keyof typeof AndroidMotionEventAction];
            let pressure: number;
            let buttons: number;

            switch (action) {
                case 'down':
                    androidAction = AndroidMotionEventAction.Down;
                    pressure = 1.0;
                    buttons = AndroidMotionEventButton.Primary;
                    break;
                case 'move':
                    androidAction = AndroidMotionEventAction.Move;
                    pressure = 1.0;
                    buttons = AndroidMotionEventButton.Primary;
                    break;
                case 'up':
                    androidAction = AndroidMotionEventAction.Up;
                    pressure = 0.0;
                    buttons = AndroidMotionEventButton.None;
                    break;
                default:
                    console.warn('Unknown touch action:', action);
                    return;
            }

            this.controller.injectTouch({
                action: androidAction,
                pointerId: BigInt(0),
                pointerX: x,
                pointerY: y,
                videoWidth: videoWidth,
                videoHeight: videoHeight,
                pressure: pressure,
                actionButton: buttons,
                buttons: buttons,
            });
        } catch (error) {
            console.error('Error sending touch event:', error);
        }
    }

    sendKeyEvent(action: string, keyCode: number, metaState: number): void {
        if (!this.controller) {
            console.warn('Controller not connected');
            return;
        }

        try {
            let androidAction: (typeof AndroidKeyEventAction)[keyof typeof AndroidKeyEventAction];

            switch (action) {
                case 'down':
                    androidAction = AndroidKeyEventAction.Down;
                    break;
                case 'up':
                    androidAction = AndroidKeyEventAction.Up;
                    break;
                default:
                    console.warn('Unknown key action:', action);
                    return;
            }

            this.controller.injectKeyCode({
                action: androidAction,
                keyCode: keyCode as AndroidKeyCode,
                repeat: 0,
                metaState: metaState as AndroidKeyEventMeta,
            });
        } catch (error) {
            console.error('Error sending key event:', error);
        }
    }

    setScreenPowerMode(mode: 0 | 2): void {
        if (!this.controller) {
            console.warn('Controller not connected');
            return;
        }

        try {
            const powerMode =
                mode === 0 ? AndroidScreenPowerMode.Off : AndroidScreenPowerMode.Normal;
            this.controller.setScreenPowerMode(powerMode);
        } catch (error) {
            console.error('Error setting screen power mode:', error);
        }
    }

    sendScroll(
        x: number,
        y: number,
        deltaX: number,
        deltaY: number,
        videoWidth: number,
        videoHeight: number
    ): void {
        if (!this.controller) {
            console.warn('Controller not connected');
            return;
        }

        if (videoWidth <= 0 || videoHeight <= 0) {
            console.warn('Invalid video size for scroll');
            return;
        }

        try {
            // Frontend sends deltaY where positive = scroll down
            // Scrcpy expects positive = scroll up, so we negate it
            // The scrollX/scrollY values are float values between -1 and 1
            const scrollX = Math.max(-1, Math.min(1, -deltaX / 120));
            const scrollY = Math.max(-1, Math.min(1, -deltaY / 120));

            this.controller.injectScroll({
                pointerX: Math.round(x),
                pointerY: Math.round(y),
                videoWidth: videoWidth,
                videoHeight: videoHeight,
                scrollX: scrollX,
                scrollY: scrollY,
                buttons: 0,
            });
        } catch (error) {
            console.error('Error sending scroll event:', error);
        }
    }

    /**
     * Asks the device to emit a keyframe immediately instead of waiting for the
     * next scheduled one. Used to resync the webview decoder after a gap in the
     * forwarded video stream.
     */
    requestKeyFrame(): void {
        if (!this.controller) {
            console.warn('Controller not connected');
            return;
        }

        try {
            this.controller.resetVideo().catch(console.error);
        } catch (error) {
            console.error('Error requesting key frame:', error);
        }
    }

    stop(): void {
        this.isRunning = false;
        this.currentDeviceId = null;
        this.ptsBase = null;
        this.lastPts = 0;

        // Abort any pending stream reads
        if (this.streamAbortController) {
            this.streamAbortController.abort();
            this.streamAbortController = null;
        }

        if (this.controller) {
            this.controller.close().catch(console.error);
            this.controller = null;
        }

        if (this.scrcpyClient) {
            this.scrcpyClient.close().catch(console.error);
            this.scrcpyClient = null;
        }

        this.adb = null;
        this.adbClient = null;

        this.events.onDisconnected();
    }

    isActive(): boolean {
        return this.isRunning;
    }

    getCurrentDeviceId(): string | null {
        return this.currentDeviceId;
    }

    async captureScreenshot(): Promise<Buffer> {
        if (!this.adb || !this.isRunning) {
            throw new Error('No connected device available for screenshot');
        }

        // Use @yume-chan/adb subprocess to capture screenshot (cross-platform)
        const result = await this.adb.subprocess.noneProtocol.spawnWait(['screencap', '-p']);
        return Buffer.from(result);
    }

    async launchApp(packageName: string): Promise<void> {
        if (!this.controller) {
            throw new Error('Controller not connected');
        }

        try {
            await this.controller.startApp(packageName);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to launch app ${packageName}: ${errorMessage}`);
        }
    }

    async pasteText(text: string): Promise<void> {
        if (!this.controller) {
            console.error('[ScrcpyService] pasteText failed - no controller');
            throw new Error('Controller not connected');
        }

        if (!text || text.length === 0) {
            console.log('[ScrcpyService] pasteText aborted - empty text');
            return;
        }

        try {
            console.log('[ScrcpyService] Calling controller.setClipboard...', {
                content: text.substring(0, 50),
                sequence: '0n',
                paste: true,
            });
            // Use setClipboard with paste=true to set device clipboard and auto-paste
            // sequence=0n means don't wait for acknowledgment
            await this.controller.setClipboard({
                content: text,
                sequence: 0n,
                paste: true,
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[ScrcpyService] setClipboard failed:', errorMessage);
            throw new Error(`Failed to paste text: ${errorMessage}`);
        }
    }
}
