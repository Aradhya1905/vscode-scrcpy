/**
 * One access unit as it leaves ScrcpyService.
 *
 * `isConfiguration` and `isKeyframe` come from the scrcpy stream itself; the
 * forwarder needs them to know where a dropped stream may safely resume.
 */
export interface VideoPacket {
    data: Buffer;
    isConfiguration: boolean;
    isKeyframe: boolean;
}

export interface VideoFrameForwarderOptions {
    postMessage: (message: unknown) => unknown;
    /** False when the webview cannot usefully render (hidden view, occluded panel). */
    isDeliverable: () => boolean;
    requestKeyFrame: () => void;
    onWarn?: (message: string) => void;
}

export interface VideoFrameForwarderStats {
    forwarded: number;
    droppedSaturated: number;
    droppedHidden: number;
}

/** ~120fps batching, low enough to stay off the latency budget. */
const BATCH_INTERVAL_MS = 8;

/** Hard ceiling on the pending batch, so a stalled webview cannot grow the heap. */
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

/**
 * Batches H.264 access units from the host into one base64 webview message per
 * tick, and owns the single rule that governs every gap in that stream: once
 * anything is dropped, nothing is forwarded until a keyframe arrives.
 *
 * Both the sidebar view and the floating panel used to carry their own copy of
 * this logic. They now differ only in `isDeliverable`.
 */
export class VideoFrameForwarder {
    private readonly options: VideoFrameForwarderOptions;

    private buffer: Buffer[] = [];
    private bufferSize = 0;
    private timer: NodeJS.Timeout | null = null;

    private saturated = false;
    /** Set by any gap. Cleared only by a configuration or keyframe packet. */
    private dropUntilKeyframe = false;

    private stats: VideoFrameForwarderStats = {
        forwarded: 0,
        droppedSaturated: 0,
        droppedHidden: 0,
    };

    constructor(options: VideoFrameForwarderOptions) {
        this.options = options;
    }

    /** Bound so it can be handed straight to `ScrcpyServiceEvents.onVideoData`. */
    handlePacket = (packet: VideoPacket): void => {
        if (!this.options.isDeliverable()) {
            this.stats.droppedHidden++;
            // Mark the gap once, on the packet that opens it. Resyncing here would
            // post a reset nobody reads and burn a keyframe request that would itself
            // be dropped; the reveal handler calls resync() at the moment it can
            // actually be used.
            if (!this.dropUntilKeyframe) {
                this.dropUntilKeyframe = true;
                this.dropBuffered();
            }
            return;
        }

        if (this.saturated) {
            this.stats.droppedSaturated++;
            this.dropAndResync();
            return;
        }

        if (this.dropUntilKeyframe) {
            if (!this.isResumePoint(packet)) {
                return;
            }
            this.dropUntilKeyframe = false;
        }

        if (this.bufferSize + packet.data.length > MAX_BUFFER_BYTES) {
            // The old path cleared the buffer here and kept forwarding, which could
            // discard SPS/PPS/IDR and leave the decoder corrupt until the next
            // scheduled keyframe (~10s on the scrcpy server default).
            this.options.onWarn?.(
                `Video buffer exceeded ${MAX_BUFFER_BYTES} bytes, resyncing the stream`
            );
            this.dropAndResync();
            return;
        }

        this.buffer.push(packet.data);
        this.bufferSize += packet.data.length;

        if (!this.timer) {
            this.timer = setTimeout(() => {
                this.timer = null;
                this.flush();
            }, BATCH_INTERVAL_MS);
        }
    };

    /**
     * Backpressure signal from the webview. While saturated, packets are dropped
     * and the stream resumes on the next keyframe.
     */
    setSaturated(saturated: boolean): void {
        if (saturated === this.saturated) {
            return;
        }
        this.saturated = saturated;
        if (saturated) {
            this.dropAndResync();
        }
    }

    /**
     * Recovers the webview decoder after a gap in the forwarded stream. Anything
     * still buffered belongs to the old GOP.
     *
     * The decoder survives a gap holding references to frames it never received,
     * so resuming mid-GOP shows corruption, or errors the decoder outright, until
     * the next scheduled keyframe. Clearing it makes it ignore everything until it
     * sees SPS/PPS/IDR again, and the keyframe request makes that arrive in
     * milliseconds rather than seconds.
     */
    resync(): void {
        this.dropBuffered();
        this.dropUntilKeyframe = true;

        // Ordering matters: the reset must reach the webview before the new frames do
        this.options.postMessage({ type: 'video-reset' });
        this.options.requestKeyFrame();
    }

    /** Full teardown, for stop and dispose. */
    reset(): void {
        this.dropBuffered();
        this.dropUntilKeyframe = false;
        this.saturated = false;
    }

    getStats(): VideoFrameForwarderStats {
        return { ...this.stats };
    }

    private dropAndResync(): void {
        if (this.dropUntilKeyframe) {
            return;
        }
        this.resync();
    }

    private dropBuffered(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.buffer = [];
        this.bufferSize = 0;
    }

    private flush(): void {
        if (this.buffer.length === 0) {
            return;
        }

        const combined = Buffer.concat(this.buffer);
        this.buffer = [];
        this.bufferSize = 0;
        this.stats.forwarded++;

        // base64 is ~33% larger than the raw bytes but avoids the far larger cost of
        // JSON-serializing a byte array.
        this.options.postMessage({ type: 'video', data: combined.toString('base64') });
    }

    /**
     * A dropped stream may only resume at a point the decoder can start from.
     * The stream flags are authoritative when present; the NAL scan is a backstop
     * for servers that do not flag keyframes, and only runs while dropping.
     */
    private isResumePoint(packet: VideoPacket): boolean {
        return packet.isConfiguration || packet.isKeyframe || containsKeyframeNal(packet.data);
    }
}

/** True if the Annex-B payload contains an SPS (type 7) or IDR (type 5) NAL unit. */
function containsKeyframeNal(data: Buffer): boolean {
    for (let i = 0; i + 3 < data.length; i++) {
        if (data[i] !== 0x00 || data[i + 1] !== 0x00) {
            continue;
        }

        let headerIndex: number;
        if (data[i + 2] === 0x01) {
            headerIndex = i + 3;
        } else if (data[i + 2] === 0x00 && data[i + 3] === 0x01) {
            headerIndex = i + 4;
        } else {
            continue;
        }

        if (headerIndex >= data.length) {
            return false;
        }

        const nalType = data[headerIndex] & 0x1f;
        if (nalType === 5 || nalType === 7) {
            return true;
        }
        i = headerIndex;
    }
    return false;
}
