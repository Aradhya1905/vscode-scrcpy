import { useRef, useCallback } from 'react';

interface UseVideoDecoderOptions {
    onLog: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

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

// Find NAL unit type from data that may have start code
function getNalType(data: Uint8Array): number {
    let offset = 0;
    if (data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) {
        offset = 4;
    } else if (data[0] === 0 && data[1] === 0 && data[2] === 1) {
        offset = 3;
    }
    return data[offset] & 0x1f;
}

// Split data into individual NAL units
function splitNalUnits(data: Uint8Array): Uint8Array[] {
    const units: Uint8Array[] = [];
    let start = 0;
    let i = 0;

    // Find first start code
    while (i < data.length - 4) {
        if (data[i] === 0 && data[i + 1] === 0) {
            if ((data[i + 2] === 0 && data[i + 3] === 1) || data[i + 2] === 1) {
                start = i;
                break;
            }
        }
        i++;
    }

    i = start + 3;

    while (i < data.length - 4) {
        if (data[i] === 0 && data[i + 1] === 0) {
            if (data[i + 2] === 0 && data[i + 3] === 1) {
                units.push(data.slice(start, i));
                start = i;
                i += 4;
                continue;
            } else if (data[i + 2] === 1) {
                units.push(data.slice(start, i));
                start = i;
                i += 3;
                continue;
            }
        }
        i++;
    }

    // Add remaining data as last NAL
    if (start < data.length) {
        units.push(data.slice(start));
    }

    return units;
}

export function useVideoDecoder({ onLog }: UseVideoDecoderOptions) {
    const decoderRef = useRef<VideoDecoder | null>(null);
    const spsNalRef = useRef<Uint8Array | null>(null);
    const ppsNalRef = useRef<Uint8Array | null>(null);
    const decoderConfiguredRef = useRef(false);
    const frameCountRef = useRef(0);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const videoSizeRef = useRef({ width: 0, height: 0 });

    // Use real timestamps based on when frames arrive for better synchronization
    const startTimeRef = useRef<number | null>(null);
    const lastFrameTimeRef = useRef<number>(0);

    // Pre-allocated buffer for base64 decoding to reduce GC pressure
    const decodeBufferRef = useRef<Uint8Array | null>(null);

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

    const configureDecoder = useCallback(
        (sps: Uint8Array, _pps: Uint8Array): boolean => {
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
                onLog(`Decoder configured with codec: ${codec}`);
                return true;
            } catch (e) {
                onLog(`Failed to configure decoder: ${(e as Error).message}`, 'error');
                return false;
            }
        },
        [createDecoder, onLog]
    );

    const processVideoPacket = useCallback(
        (data: string) => {
            // Decode base64 data - much faster than deserializing JSON arrays
            const binaryString = atob(data);
            const len = binaryString.length;

            // Reuse buffer if possible to reduce GC pressure
            let uint8Data: Uint8Array;
            if (decodeBufferRef.current && decodeBufferRef.current.length >= len) {
                uint8Data = decodeBufferRef.current.subarray(0, len);
            } else {
                // Allocate with some headroom for future frames
                decodeBufferRef.current = new Uint8Array(Math.max(len * 2, 256 * 1024));
                uint8Data = decodeBufferRef.current.subarray(0, len);
            }

            for (let i = 0; i < len; i++) {
                uint8Data[i] = binaryString.charCodeAt(i);
            }

            if (len < 5) {
                return;
            }

            const nalUnits = splitNalUnits(uint8Data);
            let hasKeyframe = false;
            const frameNals: Uint8Array[] = [];

            for (const nal of nalUnits) {
                if (nal.length < 4) continue;

                const nalType = getNalType(nal);

                // NAL types: 7=SPS, 8=PPS, 5=IDR(keyframe), 1=non-IDR
                if (nalType === 7) {
                    spsNalRef.current = nal;
                } else if (nalType === 8) {
                    ppsNalRef.current = nal;
                } else if (nalType === 5) {
                    hasKeyframe = true;
                    frameNals.push(nal);
                } else if (nalType === 1) {
                    frameNals.push(nal);
                }
            }

            // Configure decoder when we have SPS and PPS
            if (spsNalRef.current && ppsNalRef.current && !decoderConfiguredRef.current) {
                if (configureDecoder(spsNalRef.current, ppsNalRef.current)) {
                    decoderConfiguredRef.current = true;
                    // Initialize timing on first frame
                    startTimeRef.current = performance.now();
                    lastFrameTimeRef.current = 0;
                }
            }

            if (!decoderConfiguredRef.current || frameNals.length === 0) {
                return;
            }

            if (!decoderRef.current || decoderRef.current.state !== 'configured') {
                return;
            }

            try {
                // Build access unit: for keyframes include SPS+PPS
                let accessUnit: Uint8Array;
                if (hasKeyframe && spsNalRef.current && ppsNalRef.current) {
                    const totalLen =
                        spsNalRef.current.length +
                        ppsNalRef.current.length +
                        frameNals.reduce((sum, n) => sum + n.length, 0);
                    accessUnit = new Uint8Array(totalLen);
                    let offset = 0;
                    accessUnit.set(spsNalRef.current, offset);
                    offset += spsNalRef.current.length;
                    accessUnit.set(ppsNalRef.current, offset);
                    offset += ppsNalRef.current.length;
                    for (const nal of frameNals) {
                        accessUnit.set(nal, offset);
                        offset += nal.length;
                    }
                } else {
                    const totalLen = frameNals.reduce((sum, n) => sum + n.length, 0);
                    accessUnit = new Uint8Array(totalLen);
                    let offset = 0;
                    for (const nal of frameNals) {
                        accessUnit.set(nal, offset);
                        offset += nal.length;
                    }
                }

                // Use real-time timestamps for proper frame pacing
                const now = performance.now();
                const timestamp =
                    startTimeRef.current !== null
                        ? Math.round((now - startTimeRef.current) * 1000) // Convert to microseconds
                        : 0;

                // Ensure timestamps are always increasing
                const finalTimestamp = Math.max(timestamp, lastFrameTimeRef.current + 1000);
                lastFrameTimeRef.current = finalTimestamp;

                const chunk = new EncodedVideoChunk({
                    type: hasKeyframe ? 'key' : 'delta',
                    timestamp: finalTimestamp,
                    data: accessUnit,
                });

                decoderRef.current.decode(chunk);
            } catch (e) {
                onLog(`Decode error: ${(e as Error).message}`, 'error');
            }
        },
        [configureDecoder, onLog]
    );

    const reset = useCallback(() => {
        spsNalRef.current = null;
        ppsNalRef.current = null;
        decoderConfiguredRef.current = false;
        frameCountRef.current = 0;
        startTimeRef.current = null;
        lastFrameTimeRef.current = 0;
        videoSizeRef.current = { width: 0, height: 0 };
        // Keep decodeBufferRef for reuse

        if (decoderRef.current && decoderRef.current.state !== 'closed') {
            decoderRef.current.close();
        }
        decoderRef.current = null;
    }, []);

    const getVideoSize = useCallback(() => videoSizeRef.current, []);

    return {
        setCanvas,
        processVideoPacket,
        reset,
        getVideoSize,
    };
}
