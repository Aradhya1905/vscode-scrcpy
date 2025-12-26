const vscode = acquireVsCodeApi();

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const videoCanvas = document.getElementById('videoCanvas');
const placeholder = document.getElementById('placeholder');
const errorMsg = document.getElementById('errorMsg');
const debugPanel = document.getElementById('debugPanel');

const ctx = videoCanvas.getContext('2d');

let decoder = null;
let isConnected = false;
let frameCount = 0;
let videoWidth = 0;
let videoHeight = 0;
let timestamp = 0;

// H.264 state
let spsNal = null;
let ppsNal = null;
let decoderConfigured = false;

// Touch/pointer state
let isPointerDown = false;
let lastPointerPos = { x: 0, y: 0 };

// Keyboard state
let modifierState = 0;

// Android key codes (subset - common keys)
const AndroidKeyCode = {
    // Letters
    KeyA: 29,
    KeyB: 30,
    KeyC: 31,
    KeyD: 32,
    KeyE: 33,
    KeyF: 34,
    KeyG: 35,
    KeyH: 36,
    KeyI: 37,
    KeyJ: 38,
    KeyK: 39,
    KeyL: 40,
    KeyM: 41,
    KeyN: 42,
    KeyO: 43,
    KeyP: 44,
    KeyQ: 45,
    KeyR: 46,
    KeyS: 47,
    KeyT: 48,
    KeyU: 49,
    KeyV: 50,
    KeyW: 51,
    KeyX: 52,
    KeyY: 53,
    KeyZ: 54,
    // Numbers
    Digit0: 7,
    Digit1: 8,
    Digit2: 9,
    Digit3: 10,
    Digit4: 11,
    Digit5: 12,
    Digit6: 13,
    Digit7: 14,
    Digit8: 15,
    Digit9: 16,
    // Special chars
    Space: 62,
    Enter: 66,
    Backspace: 67,
    Tab: 61,
    Escape: 111,
    Minus: 69,
    Equal: 70,
    BracketLeft: 71,
    BracketRight: 72,
    Backslash: 73,
    Semicolon: 74,
    Quote: 75,
    Backquote: 68,
    Comma: 55,
    Period: 56,
    Slash: 76,
    // Arrow keys
    ArrowLeft: 21,
    ArrowRight: 22,
    ArrowUp: 19,
    ArrowDown: 20,
    // Modifiers
    ShiftLeft: 59,
    ShiftRight: 60,
    ControlLeft: 113,
    ControlRight: 114,
    AltLeft: 57,
    AltRight: 58,
    MetaLeft: 117,
    MetaRight: 118,
    // Function keys
    F1: 131,
    F2: 132,
    F3: 133,
    F4: 134,
    F5: 135,
    F6: 136,
    F7: 137,
    F8: 138,
    F9: 139,
    F10: 140,
    F11: 141,
    F12: 142,
    // Other
    Delete: 112,
    Home: 122,
    End: 123,
    PageUp: 92,
    PageDown: 93,
    Insert: 124,
    CapsLock: 115,
};

// Android key event meta state flags
const AndroidKeyEventMeta = {
    Shift: 1,
    Alt: 2,
    Ctrl: 4096,
    Meta: 65536,
};

function log(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + type;
    entry.textContent = new Date().toLocaleTimeString() + ' - ' + message;
    debugPanel.appendChild(entry);
    debugPanel.scrollTop = debugPanel.scrollHeight;
    // Keep only last 100 entries
    while (debugPanel.children.length > 100) {
        debugPanel.removeChild(debugPanel.firstChild);
    }
}

function renderFrame(frame) {
    if (videoWidth !== frame.displayWidth || videoHeight !== frame.displayHeight) {
        videoWidth = frame.displayWidth;
        videoHeight = frame.displayHeight;
        videoCanvas.width = videoWidth;
        videoCanvas.height = videoHeight;
        log('Video size: ' + videoWidth + 'x' + videoHeight, 'info');
    }

    ctx.drawImage(frame, 0, 0);
    frame.close();
    frameCount++;

    if (frameCount % 60 === 0) {
        log('Rendered ' + frameCount + ' frames', 'info');
    }
}

function createDecoder() {
    if (typeof VideoDecoder === 'undefined') {
        log('WebCodecs VideoDecoder not supported', 'error');
        return null;
    }

    return new VideoDecoder({
        output: (frame) => {
            renderFrame(frame);
        },
        error: (e) => {
            log('Decoder error: ' + e.message, 'error');
        },
    });
}

// Parse SPS to get profile/level for codec string
function parseSPS(sps) {
    // SPS starts after start code, first byte is NAL header
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

    log('Parsed SPS: profile=' + profileIdc + ', level=' + levelIdc + ', codec=' + codec, 'info');
    return codec;
}

function configureDecoder(sps, pps) {
    if (!decoder || decoder.state === 'closed') {
        decoder = createDecoder();
        if (!decoder) return false;
    }

    try {
        const codec = parseSPS(sps);

        decoder.configure({
            codec: codec,
            optimizeForLatency: true,
        });

        log('Decoder configured with codec: ' + codec, 'info');
        return true;
    } catch (e) {
        log('Failed to configure decoder: ' + e.message, 'error');
        return false;
    }
}

// Find NAL unit type from data that may have start code
function getNalType(data) {
    let offset = 0;
    if (data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) {
        offset = 4;
    } else if (data[0] === 0 && data[1] === 0 && data[2] === 1) {
        offset = 3;
    }
    return data[offset] & 0x1f;
}

// Split data into individual NAL units
function splitNalUnits(data) {
    const units = [];
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

function processVideoPacket(data) {
    const uint8Data = new Uint8Array(data);

    if (uint8Data.length < 5) {
        return;
    }

    // Split into individual NAL units
    const nalUnits = splitNalUnits(uint8Data);

    let hasKeyframe = false;
    let frameNals = [];

    for (const nal of nalUnits) {
        if (nal.length < 4) continue;

        const nalType = getNalType(nal);

        // NAL types: 7=SPS, 8=PPS, 5=IDR(keyframe), 1=non-IDR
        if (nalType === 7) {
            spsNal = nal;
            log('Got SPS (' + nal.length + ' bytes)', 'info');
        } else if (nalType === 8) {
            ppsNal = nal;
            log('Got PPS (' + nal.length + ' bytes)', 'info');
        } else if (nalType === 5) {
            hasKeyframe = true;
            frameNals.push(nal);
        } else if (nalType === 1) {
            frameNals.push(nal);
        }
    }

    // Configure decoder when we have SPS and PPS
    if (spsNal && ppsNal && !decoderConfigured) {
        if (configureDecoder(spsNal, ppsNal)) {
            decoderConfigured = true;
        }
    }

    if (!decoderConfigured || frameNals.length === 0) {
        return;
    }

    if (!decoder || decoder.state !== 'configured') {
        return;
    }

    try {
        // Build access unit: for keyframes include SPS+PPS
        let accessUnit;
        if (hasKeyframe && spsNal && ppsNal) {
            // Concatenate SPS + PPS + frame NALs
            const totalLen =
                spsNal.length + ppsNal.length + frameNals.reduce((sum, n) => sum + n.length, 0);
            accessUnit = new Uint8Array(totalLen);
            let offset = 0;
            accessUnit.set(spsNal, offset);
            offset += spsNal.length;
            accessUnit.set(ppsNal, offset);
            offset += ppsNal.length;
            for (const nal of frameNals) {
                accessUnit.set(nal, offset);
                offset += nal.length;
            }
        } else {
            // Just the frame NALs
            const totalLen = frameNals.reduce((sum, n) => sum + n.length, 0);
            accessUnit = new Uint8Array(totalLen);
            let offset = 0;
            for (const nal of frameNals) {
                accessUnit.set(nal, offset);
                offset += nal.length;
            }
        }

        const chunk = new EncodedVideoChunk({
            type: hasKeyframe ? 'key' : 'delta',
            timestamp: timestamp,
            data: accessUnit,
        });

        decoder.decode(chunk);
        timestamp += 16666; // ~60fps in microseconds
    } catch (e) {
        log('Decode error: ' + e.message, 'error');
    }
}

startBtn.addEventListener('click', () => {
    log('Starting mirror...', 'info');
    startBtn.disabled = true;
    errorMsg.style.display = 'none';

    // Reset state
    spsNal = null;
    ppsNal = null;
    decoderConfigured = false;
    frameCount = 0;
    timestamp = 0;

    if (decoder && decoder.state !== 'closed') {
        decoder.close();
    }
    decoder = null;

    vscode.postMessage({ command: 'start' });
});

stopBtn.addEventListener('click', () => {
    log('Stopping mirror...', 'info');
    vscode.postMessage({ command: 'stop' });
});

window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.type) {
        case 'connecting':
            statusIndicator.className = 'status-indicator connecting';
            statusText.textContent = 'Connecting...';
            log('Connecting to device...', 'info');
            break;

        case 'connected':
            isConnected = true;
            statusIndicator.className = 'status-indicator connected';
            statusText.textContent = 'Connected';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            placeholder.style.display = 'none';
            videoCanvas.style.display = 'block';
            log('Connected to device', 'info');
            break;

        case 'disconnected':
            isConnected = false;
            statusIndicator.className = 'status-indicator';
            statusText.textContent = 'Disconnected';
            startBtn.disabled = false;
            stopBtn.disabled = true;
            placeholder.style.display = 'block';
            videoCanvas.style.display = 'none';
            log('Disconnected from device', 'info');

            if (decoder && decoder.state !== 'closed') {
                decoder.close();
            }
            decoder = null;
            decoderConfigured = false;
            break;

        case 'video':
            if (isConnected) {
                processVideoPacket(message.data);
            }
            break;

        case 'error':
            log('Error: ' + message.message, 'error');
            errorMsg.textContent = message.message;
            errorMsg.style.display = 'block';
            startBtn.disabled = false;
            break;
    }
});

// Touch control functions
function getDeviceCoordinates(canvasX, canvasY) {
    const canvas = videoCanvas;
    if (!canvas || videoWidth === 0 || videoHeight === 0) {
        return { x: 0, y: 0 };
    }

    // Get canvas dimensions (may be scaled for responsive display)
    const canvasRect = canvas.getBoundingClientRect();

    // Convert canvas coordinates to device coordinates
    const scaleX = videoWidth / canvasRect.width;
    const scaleY = videoHeight / canvasRect.height;

    const deviceX = Math.round(canvasX * scaleX);
    const deviceY = Math.round(canvasY * scaleY);

    // Clamp to device bounds
    return {
        x: Math.max(0, Math.min(deviceX, videoWidth - 1)),
        y: Math.max(0, Math.min(deviceY, videoHeight - 1)),
    };
}

function sendTouchEvent(action, x, y) {
    if (!isConnected || videoWidth === 0 || videoHeight === 0) {
        return;
    }

    vscode.postMessage({
        command: 'touch',
        action: action,
        x: x,
        y: y,
        videoWidth: videoWidth,
        videoHeight: videoHeight,
    });

    log('Touch ' + action + ' at (' + x + ', ' + y + ')', 'info');
}

function handlePointerDown(event) {
    if (!isConnected) return;

    event.preventDefault();
    isPointerDown = true;

    // Focus canvas for keyboard events
    videoCanvas.focus();

    const canvasRect = videoCanvas.getBoundingClientRect();
    const canvasX = event.clientX - canvasRect.left;
    const canvasY = event.clientY - canvasRect.top;

    const deviceCoords = getDeviceCoordinates(canvasX, canvasY);
    lastPointerPos = deviceCoords;

    sendTouchEvent('down', deviceCoords.x, deviceCoords.y);
}

function handlePointerMove(event) {
    if (!isConnected || !isPointerDown) return;

    event.preventDefault();

    const canvasRect = videoCanvas.getBoundingClientRect();
    const canvasX = event.clientX - canvasRect.left;
    const canvasY = event.clientY - canvasRect.top;

    const deviceCoords = getDeviceCoordinates(canvasX, canvasY);

    // Only send move events if position changed significantly (reduce spam)
    if (
        Math.abs(deviceCoords.x - lastPointerPos.x) > 2 ||
        Math.abs(deviceCoords.y - lastPointerPos.y) > 2
    ) {
        lastPointerPos = deviceCoords;
        sendTouchEvent('move', deviceCoords.x, deviceCoords.y);
    }
}

function handlePointerUp(event) {
    if (!isConnected || !isPointerDown) return;

    event.preventDefault();
    isPointerDown = false;

    sendTouchEvent('up', lastPointerPos.x, lastPointerPos.y);
}

function handlePointerLeave(event) {
    if (!isConnected || !isPointerDown) return;

    isPointerDown = false;
    sendTouchEvent('up', lastPointerPos.x, lastPointerPos.y);
}

// Keyboard functions
function updateModifierState(key, pressed) {
    let newState = modifierState;

    if (key === 'Shift' || key === 'ShiftLeft' || key === 'ShiftRight') {
        newState = pressed
            ? newState | AndroidKeyEventMeta.Shift
            : newState & ~AndroidKeyEventMeta.Shift;
    } else if (key === 'Control' || key === 'ControlLeft' || key === 'ControlRight') {
        newState = pressed
            ? newState | AndroidKeyEventMeta.Ctrl
            : newState & ~AndroidKeyEventMeta.Ctrl;
    } else if (key === 'Alt' || key === 'AltLeft' || key === 'AltRight') {
        newState = pressed
            ? newState | AndroidKeyEventMeta.Alt
            : newState & ~AndroidKeyEventMeta.Alt;
    } else if (key === 'Meta' || key === 'MetaLeft' || key === 'MetaRight') {
        newState = pressed
            ? newState | AndroidKeyEventMeta.Meta
            : newState & ~AndroidKeyEventMeta.Meta;
    }

    modifierState = newState;
    return newState;
}

function sendKeyEvent(keyCode, action, metaState) {
    if (!isConnected) {
        return;
    }

    vscode.postMessage({
        command: 'key',
        action: action,
        keyCode: keyCode,
        metaState: metaState !== undefined ? metaState : modifierState,
    });

    log(
        'Key ' +
            action +
            ' keyCode=' +
            keyCode +
            ' meta=' +
            (metaState !== undefined ? metaState : modifierState),
        'info'
    );
}

function handleKeyDown(event) {
    if (!isConnected) return;

    // Update modifier state
    let newMetaState = modifierState;
    if (event.shiftKey !== ((modifierState & AndroidKeyEventMeta.Shift) !== 0)) {
        newMetaState = updateModifierState('Shift', event.shiftKey);
    }
    if (event.ctrlKey !== ((modifierState & AndroidKeyEventMeta.Ctrl) !== 0)) {
        newMetaState = updateModifierState('Control', event.ctrlKey);
    }
    if (event.altKey !== ((modifierState & AndroidKeyEventMeta.Alt) !== 0)) {
        newMetaState = updateModifierState('Alt', event.altKey);
    }
    if (event.metaKey !== ((modifierState & AndroidKeyEventMeta.Meta) !== 0)) {
        newMetaState = updateModifierState('Meta', event.metaKey);
    }

    // Map DOM code to Android keycode
    const androidKeyCode = AndroidKeyCode[event.code];

    if (androidKeyCode !== undefined) {
        event.preventDefault();
        sendKeyEvent(androidKeyCode, 'down', newMetaState);
    } else {
        log('Unmapped key: ' + event.key + ' code: ' + event.code, 'info');
    }
}

function handleKeyUp(event) {
    if (!isConnected) return;

    // Update modifier state
    let newMetaState = modifierState;
    if (event.shiftKey !== ((modifierState & AndroidKeyEventMeta.Shift) !== 0)) {
        newMetaState = updateModifierState('Shift', event.shiftKey);
    }
    if (event.ctrlKey !== ((modifierState & AndroidKeyEventMeta.Ctrl) !== 0)) {
        newMetaState = updateModifierState('Control', event.ctrlKey);
    }
    if (event.altKey !== ((modifierState & AndroidKeyEventMeta.Alt) !== 0)) {
        newMetaState = updateModifierState('Alt', event.altKey);
    }
    if (event.metaKey !== ((modifierState & AndroidKeyEventMeta.Meta) !== 0)) {
        newMetaState = updateModifierState('Meta', event.metaKey);
    }

    // Map DOM code to Android keycode
    const androidKeyCode = AndroidKeyCode[event.code];

    if (androidKeyCode !== undefined) {
        event.preventDefault();
        sendKeyEvent(androidKeyCode, 'up', newMetaState);
    }
}

// Attach touch/pointer event listeners
videoCanvas.addEventListener('pointerdown', handlePointerDown);
videoCanvas.addEventListener('pointermove', handlePointerMove);
videoCanvas.addEventListener('pointerup', handlePointerUp);
videoCanvas.addEventListener('pointerleave', handlePointerLeave);

// Attach keyboard event listeners
videoCanvas.addEventListener('keydown', handleKeyDown);
videoCanvas.addEventListener('keyup', handleKeyUp);

// Set canvas properties for better touch handling
videoCanvas.style.touchAction = 'none';
videoCanvas.tabIndex = 0; // Make canvas focusable

// Notify extension that webview is ready
vscode.postMessage({ command: 'ready' });
log('Webview initialized with touch and keyboard controls', 'info');
