import { useRef, useCallback, useEffect } from 'react';

interface UseVideoDecoderOptions {
    onLog: (message: string, level?: 'info' | 'warn' | 'error') => void;
    /** Asks the device for an IDR. Must be stable. */
    onRequestKeyFrame: () => void;
    /**
     * Reports that this webview can no longer keep up with the stream, or that it
     * can again. Called only on a change, never per frame. Must be stable.
     */
    onBackpressureChange: (saturated: boolean) => void;
}

/** NAL unit type carrying the sequence parameter set. */
const NAL_SPS = 7;

// Maximum decode queue size before we start dropping non-keyframes
const MAX_DECODE_QUEUE_SIZE = 3;

/**
 * Acceleration hints to try, in order. `null` means configure with no hint at all,
 * for implementations that reject the field.
 *
 * Annex-B throughout: switching to avcC/`description` would mean rewriting every
 * access unit from start codes to length prefixes on every frame.
 */
const ACCELERATION_CANDIDATES: (HardwareAcceleration | null)[] = [
    'prefer-hardware',
    'no-preference',
    null,
];

/**
 * Backpressure thresholds for the upstream signal.
 *
 * Two independent entry conditions, because either failure mode can occur alone:
 * a queue that keeps growing past MAX_DECODE_QUEUE_SIZE (only keyframes can push
 * it there, since deltas are dropped above that), and a long unbroken run of
 * locally dropped deltas, which pins the queue just under the drop threshold and
 * would otherwise never trip a depth test. The run length is deliberately long
 * (~0.5 s at 60 fps) so a momentary hiccup cannot degrade the picture.
 */
const BACKPRESSURE_ENTER_QUEUE = 6;
const BACKPRESSURE_ENTER_FRAMES = 2;
const BACKPRESSURE_ENTER_DROP_RUN = 30;

/** Queue depth, and how many consecutive samples at it, before declaring recovery. */
const BACKPRESSURE_LEAVE_QUEUE = 2;
const BACKPRESSURE_LEAVE_SAMPLES = 5;

/** Minimum spacing between posts, so the signal itself cannot flood the channel. */
const BACKPRESSURE_MIN_INTERVAL_MS = 250;

/**
 * Sampling interval while saturated. Arriving frames cannot drive the recovery
 * test: the extension is down to keyframes by then, so the queue would be sampled
 * about once a second.
 */
const BACKPRESSURE_POLL_MS = 100;

type DecoderConfigState = 'idle' | 'configuring' | 'ready' | 'failed';

/** Consecutive decoder errors, with no frame drawn in between, before giving up. */
const MAX_RECOVERY_ATTEMPTS = 3;

// Parse SPS to get profile/level for codec string
function parseSPS(sps: Uint8Array): string {
    let offset = 0;
    if (sps[0] === 0 && sps[1] === 0 && sps[2] === 0 && sps[3] === 1) {
        offset = 4;
    } else if (sps[0] === 0 && sps[1] === 0 && sps[2] === 1) {
        offset = 3;
    }

    // Skip NAL header byte
    offset += 1;

    const profileIdc = sps[offset];
    const constraints = sps[offset + 1];
    const levelIdc = sps[offset + 2];

    // Create codec string like "avc1.640028"
    const codec =
        'avc1.' +
        profileIdc.toString(16).padStart(2, '0') +
        constraints.toString(16).padStart(2, '0') +
        levelIdc.toString(16).padStart(2, '0');

    return codec;
}

/**
 * First NAL unit of `nalType` in an Annex-B payload, as a view including its
 * start code, or null if there is none.
 *
 * This replaces the old split-every-NAL-then-reassemble pass. It runs only when
 * the decoder needs configuring - once per stream, or once per recovery - never
 * per frame.
 */
function findNal(data: Uint8Array, nalType: number): Uint8Array | null {
    let start = -1;

    for (let i = 0; i + 3 < data.length; i++) {
        if (data[i] !== 0x00 || data[i + 1] !== 0x00) {
            continue;
        }

        let payloadIndex: number;
        if (data[i + 2] === 0x01) {
            payloadIndex = i + 3;
        } else if (data[i + 2] === 0x00 && data[i + 3] === 0x01) {
            payloadIndex = i + 4;
        } else {
            continue;
        }

        if (payloadIndex >= data.length) {
            break;
        }

        // A match ends where the next start code begins.
        if (start >= 0) {
            return data.subarray(start, i);
        }

        if ((data[payloadIndex] & 0x1f) === nalType) {
            start = i;
        }
        i = payloadIndex;
    }

    return start >= 0 ? data.subarray(start) : null;
}

export function useVideoDecoder({
    onLog,
    onRequestKeyFrame,
    onBackpressureChange,
}: UseVideoDecoderOptions) {
    const decoderRef = useRef<VideoDecoder | null>(null);
    /** Last SPS+PPS blob seen, kept so the decoder can be rebuilt without one inline. */
    const configRef = useRef<Uint8Array | null>(null);
    const configStateRef = useRef<DecoderConfigState>('idle');
    /**
     * Where the candidate walk starts. Sticky for the session: once hardware
     * decoding has failed at runtime there is no point offering it again.
     */
    const accelIndexRef = useRef(0);
    const recoveryAttemptsRef = useRef(0);
    const frameCountRef = useRef(0);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const videoSizeRef = useRef({ width: 0, height: 0 });

    /** The one frame waiting to be drawn, and the rAF that will draw it. */
    const pendingFrameRef = useRef<VideoFrame | null>(null);
    const rafRef = useRef<number | null>(null);

    /** Highest chunk timestamp handed to the decoder, in microseconds. */
    const lastTimestampRef = useRef(0);

    // Frame skipping metrics for backpressure handling
    const droppedFramesRef = useRef(0);
    const lastDropLogTimeRef = useRef(0);

    /** Upstream backpressure state, and the evidence counters behind each transition. */
    const saturatedRef = useRef(false);
    const deepQueueRunRef = useRef(0);
    const localDropRunRef = useRef(0);
    const shallowQueueRunRef = useRef(0);
    const lastSignalTimeRef = useRef(0);
    const pollTimerRef = useRef<number | null>(null);

    // Logged at most once per session, so a wire-format mismatch is visible
    // without flooding the console at frame rate.
    const badPayloadLoggedRef = useRef(false);

    const setCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
        canvasRef.current = canvas;
        // Use 'low-latency' rendering hint for better performance
        ctxRef.current =
            canvas?.getContext('2d', {
                alpha: false,
                desynchronized: true, // Allow asynchronous drawing for lower latency
            }) ?? null;

        // A remount - the device-skin toggle does one - hands over a fresh canvas at
        // its default 300x150. The size block in present() only fires when the frame
        // size changes, so without this the new canvas keeps that default and
        // drawImage crops the picture to it.
        if (canvas && videoSizeRef.current.width > 0) {
            canvas.width = videoSizeRef.current.width;
            canvas.height = videoSizeRef.current.height;
        }
    }, []);

    /**
     * Draws the newest decoded frame, once per vsync.
     *
     * `desynchronized: true` means a 2D canvas presents at vsync regardless, so
     * drawing earlier buys no perceived latency - it only front-loads main-thread
     * work. Pacing here bounds compositing when maxFps exceeds the refresh rate,
     * absorbs a burst after a stall by drawing the newest frame and closing the
     * rest, and gives every frame exactly one close() site.
     */
    const present = useCallback(() => {
        rafRef.current = null;

        const frame = pendingFrameRef.current;
        pendingFrameRef.current = null;
        if (!frame) {
            return;
        }

        // close() in a finally: a VideoFrame leaked because drawImage threw (the
        // canvas can detach mid-draw when the device skin remounts it) permanently
        // stalls the decoder after about four of them.
        try {
            const canvas = canvasRef.current;
            const ctx = ctxRef.current;
            if (!canvas || !ctx) {
                return;
            }

            // This block has to stay with the draw. VideoCanvas.updateRenderGeometry
            // reads videoSizeRef via getVideoSize(), and geometry that stays zero
            // makes every touch silently miss.
            if (
                videoSizeRef.current.width !== frame.displayWidth ||
                videoSizeRef.current.height !== frame.displayHeight
            ) {
                videoSizeRef.current = { width: frame.displayWidth, height: frame.displayHeight };
                canvas.width = frame.displayWidth;
                canvas.height = frame.displayHeight;
                onLog(`Video size: ${frame.displayWidth}x${frame.displayHeight}`);
            }

            ctx.drawImage(frame, 0, 0);
            frameCountRef.current++;
            // A drawn frame is the only proof the current configuration works.
            recoveryAttemptsRef.current = 0;

            if (frameCountRef.current % 60 === 0) {
                onLog(`Rendered ${frameCountRef.current} frames`);
            }
        } finally {
            frame.close();
        }
    }, [onLog]);

    /** Keeps one frame in flight: the newest. Anything it displaces is closed now. */
    const onDecoderOutput = useCallback(
        (frame: VideoFrame) => {
            const stale = pendingFrameRef.current;
            pendingFrameRef.current = frame;
            stale?.close();

            if (rafRef.current === null) {
                rafRef.current = requestAnimationFrame(present);
            }
        },
        [present]
    );

    /** Cancels the pending present and closes the frame waiting in the slot. */
    const clearPendingFrame = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        pendingFrameRef.current?.close();
        pendingFrameRef.current = null;
    }, []);

    /** Stops the recovery poll. Safe to call when none is running. */
    const stopBackpressurePoll = useCallback(() => {
        if (pollTimerRef.current !== null) {
            clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    // Unmount must not leave a frame open or a timer running; the decoder is closed
    // by reset().
    useEffect(
        () => () => {
            clearPendingFrame();
            stopBackpressurePoll();
        },
        [clearPendingFrame, stopBackpressurePoll]
    );

    const createDecoder = useCallback(() => {
        if (typeof VideoDecoder === 'undefined') {
            onLog('WebCodecs VideoDecoder not supported', 'error');
            return null;
        }

        return new VideoDecoder({
            output: onDecoderOutput,
            error: (e) => {
                onLog(`Decoder error: ${e.message}`, 'error');

                // A decoder error is fatal - the decoder is now closed. If hardware
                // decoding was in use, this is where it usually surfaces: a config
                // can report supported and still fail at runtime. Drop the
                // preference for the rest of the session rather than looping on it.
                if (accelIndexRef.current === 0) {
                    accelIndexRef.current = 1;
                    onLog('Hardware decoding failed; falling back for this session', 'warn');
                }

                // An error that repeats through every rebuild would otherwise spin
                // error -> reconfigure -> error at keyframe rate, each turn costing a
                // keyframe request.
                recoveryAttemptsRef.current++;
                if (recoveryAttemptsRef.current > MAX_RECOVERY_ATTEMPTS) {
                    configStateRef.current = 'failed';
                    onLog(
                        'Decoder failed repeatedly; giving up until the stream restarts',
                        'error'
                    );
                    return;
                }

                // Rebuild on the next keyframe, which carries its own SPS+PPS - so
                // recovery costs one round trip rather than a whole GOP.
                configStateRef.current = 'idle';
                onRequestKeyFrame();
            },
        });
    }, [onDecoderOutput, onLog, onRequestKeyFrame]);

    /**
     * Payload bytes, or null if the message carried something unusable.
     *
     * The extension posts an exact-bounds ArrayBuffer, which VS Code transfers
     * rather than clones. A view is accepted too, so a host that clones instead
     * still renders rather than showing a permanently black canvas.
     */
    const toBytes = useCallback(
        (payload: ArrayBuffer | ArrayBufferView): Uint8Array | null => {
            if (payload instanceof ArrayBuffer) {
                return new Uint8Array(payload);
            }
            if (ArrayBuffer.isView(payload)) {
                return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
            }

            if (!badPayloadLoggedRef.current) {
                badPayloadLoggedRef.current = true;
                onLog('Video payload is neither an ArrayBuffer nor a view; dropping', 'error');
            }
            return null;
        },
        [onLog]
    );

    /**
     * Configures the decoder from an Annex-B blob containing an SPS, walking the
     * acceleration candidates until one reports supported and configures cleanly.
     *
     * Async because `isConfigSupported` is: frames arriving in the meantime are
     * dropped, and a keyframe is requested once the decoder is ready.
     */
    const configureDecoder = useCallback(
        async (annexB: Uint8Array): Promise<void> => {
            const sps = findNal(annexB, NAL_SPS);
            if (!sps) {
                onLog('No SPS in video configuration; cannot configure decoder', 'error');
                configStateRef.current = 'failed';
                return;
            }

            if (typeof VideoDecoder === 'undefined') {
                onLog('WebCodecs VideoDecoder not supported', 'error');
                configStateRef.current = 'failed';
                return;
            }

            configStateRef.current = 'configuring';

            // Every exit from here must leave a state other than 'configuring':
            // getting stuck there means a black screen that nothing recovers from.
            try {
                const codec = parseSPS(sps);

                for (let i = accelIndexRef.current; i < ACCELERATION_CANDIDATES.length; i++) {
                    const acceleration = ACCELERATION_CANDIDATES[i];
                    const config: VideoDecoderConfig = { codec, optimizeForLatency: true };
                    if (acceleration) {
                        config.hardwareAcceleration = acceleration;
                    }

                    try {
                        const support = await VideoDecoder.isConfigSupported(config);
                        if (!support.supported) {
                            continue;
                        }
                    } catch {
                        // Some implementations reject rather than reporting unsupported.
                        continue;
                    }

                    if (!decoderRef.current || decoderRef.current.state === 'closed') {
                        decoderRef.current = createDecoder();
                        if (!decoderRef.current) {
                            configStateRef.current = 'failed';
                            return;
                        }
                    }

                    try {
                        decoderRef.current.configure(config);
                    } catch (e) {
                        onLog(`Failed to configure decoder: ${(e as Error).message}`, 'warn');
                        continue;
                    }

                    // Remember the winner, so a later reconfigure skips the candidates
                    // already known to fail.
                    accelIndexRef.current = i;
                    configStateRef.current = 'ready';
                    lastTimestampRef.current = 0;
                    onLog(
                        `Decoder configured: ${codec}, acceleration: ${acceleration ?? 'default'}`
                    );

                    // Nothing decoded during the walk, so ask for an IDR to start from.
                    onRequestKeyFrame();
                    return;
                }

                configStateRef.current = 'failed';
                onLog(`No supported decoder configuration for codec ${codec}`, 'error');
            } catch (e) {
                configStateRef.current = 'failed';
                onLog(`Decoder configuration failed: ${(e as Error).message}`, 'error');
            }
        },
        [createDecoder, onLog, onRequestKeyFrame]
    );

    const processVideoConfig = useCallback(
        (payload: ArrayBuffer | ArrayBufferView) => {
            const config = toBytes(payload);
            if (!config || config.length === 0) {
                return;
            }

            configRef.current = config;
            if (configStateRef.current === 'idle') {
                void configureDecoder(config);
            }
        },
        [configureDecoder, toBytes]
    );

    /**
     * A decoder ready to accept this packet, or null if it must be dropped.
     *
     * Only a keyframe can start or restart decoding, and since the extension
     * prepends SPS+PPS to every keyframe, any keyframe suffices. That single path
     * covers first configuration, recovery after a decoder error, and resuming
     * after a `video-reset` - no separate recovery branch needed.
     *
     * Configuration is async, so this never returns a decoder on the packet that
     * starts it; the requested keyframe is the one that gets decoded.
     */
    const readyDecoder = useCallback(
        (data: Uint8Array, keyframe: boolean): VideoDecoder | null => {
            const decoder = decoderRef.current;
            if (configStateRef.current === 'ready') {
                if (decoder && decoder.state === 'configured') {
                    return decoder;
                }
                // 'ready' over a decoder that is gone would strand every frame here,
                // since only 'idle' reconfigures.
                configStateRef.current = 'idle';
            }

            // 'configuring' has a walk in flight; 'failed' found no usable config for
            // this codec and only a reset (a new stream) is worth retrying for.
            if (!keyframe || configStateRef.current !== 'idle') {
                return null;
            }

            if (decoder && decoder.state !== 'closed') {
                try {
                    decoder.close();
                } catch {
                    // Ignore close errors
                }
            }
            decoderRef.current = null;

            // Prefer the configuration carried by this keyframe; fall back to the
            // last one seen if the extension had none to prepend.
            const inlineConfig = findNal(data, NAL_SPS) ? data : configRef.current;
            if (inlineConfig) {
                void configureDecoder(inlineConfig);
            }
            return null;
        },
        [configureDecoder]
    );

    /** Posts one transition and clears the evidence behind it. */
    const signalBackpressure = useCallback(
        (saturated: boolean) => {
            saturatedRef.current = saturated;
            lastSignalTimeRef.current = performance.now();
            deepQueueRunRef.current = 0;
            localDropRunRef.current = 0;
            shallowQueueRunRef.current = 0;

            onLog(
                saturated
                    ? 'Decoder saturated; asking the extension for keyframes only'
                    : 'Decoder caught up; asking the extension for the full stream',
                saturated ? 'warn' : 'info'
            );
            onBackpressureChange(saturated);
        },
        [onBackpressureChange, onLog]
    );

    /**
     * Samples the queue while saturated and clears the signal once it has stayed
     * shallow long enough to trust. Self-terminating: the last tick either posts
     * the recovery or schedules the next one.
     */
    const startBackpressurePoll = useCallback(() => {
        if (pollTimerRef.current !== null) {
            return;
        }

        const poll = (): void => {
            pollTimerRef.current = null;
            if (!saturatedRef.current) {
                return;
            }

            const queueSize = decoderRef.current?.decodeQueueSize ?? 0;
            shallowQueueRunRef.current =
                queueSize <= BACKPRESSURE_LEAVE_QUEUE ? shallowQueueRunRef.current + 1 : 0;

            if (
                shallowQueueRunRef.current >= BACKPRESSURE_LEAVE_SAMPLES &&
                performance.now() - lastSignalTimeRef.current >= BACKPRESSURE_MIN_INTERVAL_MS
            ) {
                signalBackpressure(false);
                return;
            }

            pollTimerRef.current = window.setTimeout(poll, BACKPRESSURE_POLL_MS);
        };

        pollTimerRef.current = window.setTimeout(poll, BACKPRESSURE_POLL_MS);
    }, [signalBackpressure]);

    /**
     * Decides whether this webview has fallen behind far enough that the extension
     * should stop sending it delta frames at all.
     *
     * Dropping locally already saves the decode, but the frame still cost a host
     * copy, a postMessage and a structured clone by the time it gets here. The
     * signal is what removes that cost.
     */
    const noteQueueDepth = useCallback(
        (queueSize: number, droppedLocally: boolean) => {
            if (saturatedRef.current) {
                // Recovery is the poll's call: while saturated, the only frames that
                // arrive are keyframes, far too sparse to sample on.
                return;
            }

            deepQueueRunRef.current =
                queueSize > BACKPRESSURE_ENTER_QUEUE ? deepQueueRunRef.current + 1 : 0;
            localDropRunRef.current = droppedLocally ? localDropRunRef.current + 1 : 0;

            const saturated =
                deepQueueRunRef.current >= BACKPRESSURE_ENTER_FRAMES ||
                localDropRunRef.current >= BACKPRESSURE_ENTER_DROP_RUN;
            if (
                !saturated ||
                performance.now() - lastSignalTimeRef.current < BACKPRESSURE_MIN_INTERVAL_MS
            ) {
                return;
            }

            signalBackpressure(true);
            startBackpressurePoll();
        },
        [signalBackpressure, startBackpressurePoll]
    );

    const processVideoPacket = useCallback(
        (payload: ArrayBuffer | ArrayBufferView, keyframe: boolean, pts: number) => {
            // Backpressure first. With `keyframe` arriving as a message field this is
            // a field read; the old code paid a base64 decode and a full NAL scan
            // before it could make the same decision.
            const queueSize = decoderRef.current?.decodeQueueSize ?? 0;
            const droppedLocally = !keyframe && queueSize > MAX_DECODE_QUEUE_SIZE;
            noteQueueDepth(queueSize, droppedLocally);

            if (droppedLocally) {
                droppedFramesRef.current++;

                // Log dropped frames periodically (at most once per second)
                const now = performance.now();
                if (now - lastDropLogTimeRef.current > 1000) {
                    onLog(
                        `Decoder backpressure: dropped ${droppedFramesRef.current} non-keyframes (queue: ${queueSize})`,
                        'warn'
                    );
                    droppedFramesRef.current = 0;
                    lastDropLogTimeRef.current = now;
                }
                return;
            }

            const data = toBytes(payload);
            if (!data || data.length < 5) {
                return;
            }

            const decoder = readyDecoder(data, keyframe);
            if (!decoder) {
                return;
            }

            // The extension already rebases pts to a monotonic microsecond series;
            // the clamp is insurance, because a timestamp that does not increase
            // makes the decoder reject the chunk.
            const timestamp =
                pts > lastTimestampRef.current ? pts : lastTimestampRef.current + 1000;
            lastTimestampRef.current = timestamp;

            try {
                decoder.decode(
                    new EncodedVideoChunk({
                        type: keyframe ? 'key' : 'delta',
                        timestamp,
                        data,
                    })
                );
            } catch (e) {
                onLog(`Decode error: ${(e as Error).message}`, 'error');
            }
        },
        [noteQueueDepth, onLog, readyDecoder, toBytes]
    );

    const reset = useCallback(() => {
        configRef.current = null;
        // Back to 'idle', but accelIndexRef stays: the fallback is per session, not
        // per stream.
        configStateRef.current = 'idle';
        recoveryAttemptsRef.current = 0;
        frameCountRef.current = 0;
        lastTimestampRef.current = 0;
        videoSizeRef.current = { width: 0, height: 0 };
        droppedFramesRef.current = 0;
        lastDropLogTimeRef.current = 0;
        clearPendingFrame();

        if (decoderRef.current && decoderRef.current.state !== 'closed') {
            decoderRef.current.close();
        }
        decoderRef.current = null;
    }, [clearPendingFrame]);

    const getVideoSize = useCallback(() => videoSizeRef.current, []);

    return {
        setCanvas,
        processVideoConfig,
        processVideoPacket,
        reset,
        getVideoSize,
    };
}
