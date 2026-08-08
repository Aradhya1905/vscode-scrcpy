import { useRef, useCallback } from 'react';

interface UseVideoDecoderOptions {
    onLog: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/** NAL unit type carrying the sequence parameter set. */
const NAL_SPS = 7;

// Maximum decode queue size before we start dropping non-keyframes
const MAX_DECODE_QUEUE_SIZE = 3;

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

export function useVideoDecoder({ onLog }: UseVideoDecoderOptions) {
    const decoderRef = useRef<VideoDecoder | null>(null);
    /** Last SPS+PPS blob seen, kept so the decoder can be rebuilt without one inline. */
    const configRef = useRef<Uint8Array | null>(null);
    const frameCountRef = useRef(0);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const videoSizeRef = useRef({ width: 0, height: 0 });

    /** Highest chunk timestamp handed to the decoder, in microseconds. */
    const lastTimestampRef = useRef(0);

    // Frame skipping metrics for backpressure handling
    const droppedFramesRef = useRef(0);
    const lastDropLogTimeRef = useRef(0);

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
    }, []);

    const renderFrame = useCallback(
        (frame: VideoFrame) => {
            const canvas = canvasRef.current;
            const ctx = ctxRef.current;
            if (!canvas || !ctx) {
                frame.close();
                return;
            }

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
            frame.close();
            frameCountRef.current++;

            if (frameCountRef.current % 60 === 0) {
                onLog(`Rendered ${frameCountRef.current} frames`);
            }
        },
        [onLog]
    );

    const createDecoder = useCallback(() => {
        if (typeof VideoDecoder === 'undefined') {
            onLog('WebCodecs VideoDecoder not supported', 'error');
            return null;
        }

        return new VideoDecoder({
            output: renderFrame,
            error: (e) => {
                onLog(`Decoder error: ${e.message}`, 'error');
            },
        });
    }, [onLog, renderFrame]);

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

    /** Configures the decoder from an Annex-B blob that contains an SPS. */
    const configureDecoder = useCallback(
        (annexB: Uint8Array): boolean => {
            const sps = findNal(annexB, NAL_SPS);
            if (!sps) {
                onLog('No SPS in video configuration; cannot configure decoder', 'error');
                return false;
            }

            if (!decoderRef.current || decoderRef.current.state === 'closed') {
                decoderRef.current = createDecoder();
                if (!decoderRef.current) return false;
            }

            try {
                const codec = parseSPS(sps);
                decoderRef.current.configure({
                    codec,
                    optimizeForLatency: true,
                });
                lastTimestampRef.current = 0;
                onLog(`Decoder configured with codec: ${codec}`);
                return true;
            } catch (e) {
                onLog(`Failed to configure decoder: ${(e as Error).message}`, 'error');
                return false;
            }
        },
        [createDecoder, onLog]
    );

    const processVideoConfig = useCallback(
        (payload: ArrayBuffer | ArrayBufferView) => {
            const config = toBytes(payload);
            if (!config || config.length === 0) {
                return;
            }

            configRef.current = config;
            configureDecoder(config);
        },
        [configureDecoder, toBytes]
    );

    /**
     * A decoder in the 'configured' state, rebuilding it if necessary.
     *
     * Only a keyframe can start or restart decoding, and since the extension
     * prepends SPS+PPS to every keyframe, any keyframe suffices. That single path
     * covers first configuration, recovery after a decoder error, and resuming
     * after a `video-reset` - no separate recovery branch needed.
     */
    const ensureDecoder = useCallback(
        (data: Uint8Array, keyframe: boolean): VideoDecoder | null => {
            const decoder = decoderRef.current;
            if (decoder && decoder.state === 'configured') {
                return decoder;
            }

            if (!keyframe) {
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
            if (!inlineConfig || !configureDecoder(inlineConfig)) {
                return null;
            }

            onLog('Decoder configured from keyframe', 'info');
            return decoderRef.current;
        },
        [configureDecoder, onLog]
    );

    const processVideoPacket = useCallback(
        (payload: ArrayBuffer | ArrayBufferView, keyframe: boolean, pts: number) => {
            // Backpressure first. With `keyframe` arriving as a message field this is
            // a field read; the old code paid a base64 decode and a full NAL scan
            // before it could make the same decision.
            const queueSize = decoderRef.current?.decodeQueueSize ?? 0;
            if (!keyframe && queueSize > MAX_DECODE_QUEUE_SIZE) {
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

            const decoder = ensureDecoder(data, keyframe);
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
        [ensureDecoder, onLog, toBytes]
    );

    const reset = useCallback(() => {
        configRef.current = null;
        frameCountRef.current = 0;
        lastTimestampRef.current = 0;
        videoSizeRef.current = { width: 0, height: 0 };
        droppedFramesRef.current = 0;
        lastDropLogTimeRef.current = 0;

        if (decoderRef.current && decoderRef.current.state !== 'closed') {
            decoderRef.current.close();
        }
        decoderRef.current = null;
    }, []);

    const getVideoSize = useCallback(() => videoSizeRef.current, []);

    return {
        setCanvas,
        processVideoConfig,
        processVideoPacket,
        reset,
        getVideoSize,
    };
}
