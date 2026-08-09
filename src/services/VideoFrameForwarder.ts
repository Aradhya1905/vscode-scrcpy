/**
 * One access unit as it leaves ScrcpyService.
 *
 * `data` is always backed by a standalone, exact-bounds ArrayBuffer that nothing
 * else references, so the forwarder can hand it to `postMessage` without another
 * copy. `keyframe` comes from the scrcpy stream itself, and tells the forwarder
 * where a dropped stream may safely resume.
 */
export type ScrcpyVideoPacket =
    | { type: 'config'; data: Uint8Array }
    | { type: 'frame'; data: Uint8Array; keyframe: boolean; pts: number };

export interface VideoFrameForwarderOptions {
    postMessage: (message: unknown) => unknown;
    /** False when the webview cannot usefully render (hidden view, occluded panel). */
    isDeliverable: () => boolean;
    requestKeyFrame: () => void;
}

export interface VideoFrameForwarderStats {
    forwarded: number;
    droppedSaturated: number;
    droppedHidden: number;
}

/** NAL unit types that a decoder can start from. */
const NAL_IDR = 5;
const NAL_SPS = 7;

/**
 * Forwards H.264 access units from the host to a webview as raw ArrayBuffers -
 * one message per access unit - and owns the single rule that governs every gap
 * in that stream: once anything is dropped, nothing is forwarded until a
 * keyframe arrives.
 *
 * There is deliberately no batching. `sendFrameMeta: true` already delivers
 * exactly one access unit per packet, so a batch window could only add latency
 * and merge access units that the decoder must see separately.
 *
 * Both the sidebar view and the floating panel own one instance and differ only
 * in `isDeliverable`.
 */
export class VideoFrameForwarder {
    private readonly options: VideoFrameForwarderOptions;

    /** Last SPS+PPS blob seen, prepended to every keyframe. */
    private lastConfig: Uint8Array | null = null;

    private saturated = false;
    /** Set by any gap. Cleared only by a keyframe. */
    private dropUntilKeyframe = false;

    private stats: VideoFrameForwarderStats = {
        forwarded: 0,
        droppedSaturated: 0,
        droppedHidden: 0,
    };

    constructor(options: VideoFrameForwarderOptions) {
        this.options = options;
    }

    /** Bound so it can be handed straight to `ScrcpyServiceEvents.onVideoPacket`. */
    handlePacket = (packet: ScrcpyVideoPacket): void => {
        // Cached before the deliverable check: a configuration packet that arrives
        // while the surface is hidden is still the only SPS/PPS this stream will
        // send, and the keyframe that resumes it has to carry them.
        if (packet.type === 'config') {
            this.lastConfig = packet.data;
        }

        if (!this.options.isDeliverable()) {
            this.stats.droppedHidden++;
            // Mark the gap once, on the packet that opens it. Resyncing here would
            // post a reset nobody reads and burn a keyframe request that would itself
            // be dropped; the reveal handler calls resync() at the moment it can
            // actually be used.
            this.dropUntilKeyframe = true;
            return;
        }

        if (packet.type === 'config') {
            // Posted as a fresh copy: postMessage may transfer the buffer, which
            // would detach the cached one.
            this.options.postMessage({ type: 'video-config', data: copyToBuffer(packet.data) });
            return;
        }

        // One gate for both gap states. While saturated it never reopens: keyframes
        // pass, everything between them is dropped, so the webview keeps a picture
        // (and the traffic it needs to notice it has caught up) at a fraction of the
        // encode and IPC cost.
        if (this.saturated || this.dropUntilKeyframe) {
            if (!this.isResumePoint(packet)) {
                if (this.saturated) {
                    this.stats.droppedSaturated++;
                }
                return;
            }
            this.dropUntilKeyframe = false;
        }

        this.stats.forwarded++;
        this.options.postMessage({
            type: 'video',
            k: packet.keyframe ? 1 : 0,
            pts: packet.pts,
            data: packet.keyframe ? this.withConfig(packet.data) : exactBuffer(packet.data),
        });
    };

    /**
     * Backpressure signal from the webview, which sends it when its decode queue
     * stays deep - the webview is the only side that can see that, since the host
     * has no view of decode cost.
     *
     * Entering resyncs once so the webview starts the degraded stream from a clean
     * keyframe; leaving needs nothing, because the very next delta frame is
     * forwarded again.
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
     * Recovers the webview decoder after a gap in the forwarded stream.
     *
     * The decoder survives a gap holding references to frames it never received,
     * so resuming mid-GOP shows corruption, or errors the decoder outright, until
     * the next scheduled keyframe. Resetting it makes it ignore everything until it
     * sees SPS/PPS/IDR again, and the keyframe request makes that arrive in
     * milliseconds rather than seconds - immediately usable, because the keyframe
     * carries its own configuration.
     */
    resync(): void {
        this.dropUntilKeyframe = true;

        // Ordering matters: the reset must reach the webview before the new frames do
        this.options.postMessage({ type: 'video-reset' });
        this.options.requestKeyFrame();
    }

    /** Full teardown, for stop and dispose. */
    reset(): void {
        this.dropUntilKeyframe = false;
        this.saturated = false;
        this.lastConfig = null;
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

    /**
     * Prepends SPS+PPS so every keyframe is self-sufficient. That lets the webview
     * configure or recover from any keyframe rather than from the one `video-config`
     * message, whose loss would otherwise mean a permanently black screen - and it
     * replaces the per-keyframe access-unit rebuild the webview used to do.
     */
    private withConfig(frame: Uint8Array): ArrayBufferLike {
        const config = this.lastConfig;
        if (!config) {
            return exactBuffer(frame);
        }

        const combined = new Uint8Array(config.length + frame.length);
        combined.set(config, 0);
        combined.set(frame, config.length);
        return combined.buffer;
    }

    /**
     * A dropped stream may only resume at a point the decoder can start from.
     * The stream flag is authoritative when present; the NAL scan is a backstop
     * for servers that do not flag keyframes, and only runs while dropping.
     */
    private isResumePoint(packet: { data: Uint8Array; keyframe: boolean }): boolean {
        return packet.keyframe || containsKeyframeNal(packet.data);
    }
}

/**
 * The underlying ArrayBuffer, when it holds exactly this view and nothing else.
 *
 * VS Code's postMessage transfers an ArrayBuffer efficiently rather than cloning
 * it, but it transfers the whole buffer - so a view into a larger slab would ship
 * the slab. ScrcpyService allocates each packet standalone, making this the
 * zero-copy path; the copy is a correctness fallback, not the expected case.
 */
function exactBuffer(data: Uint8Array): ArrayBufferLike {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
        return data.buffer;
    }
    return copyToBuffer(data);
}

function copyToBuffer(data: Uint8Array): ArrayBufferLike {
    const copy = new Uint8Array(data.length);
    copy.set(data);
    return copy.buffer;
}

/** True if the Annex-B payload contains an SPS or IDR NAL unit. */
function containsKeyframeNal(data: Uint8Array): boolean {
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
        if (nalType === NAL_IDR || nalType === NAL_SPS) {
            return true;
        }
        i = headerIndex;
    }
    return false;
}
