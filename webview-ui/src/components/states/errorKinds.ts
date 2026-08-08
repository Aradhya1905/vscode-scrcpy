/**
 * Maps a raw failure message onto something a user can act on.
 *
 * Every one of these strings used to surface under the single title
 * "Connection Lost", which is wrong for the common case: failing to connect in
 * the first place means nothing was ever lost. Anything unrecognised keeps a
 * generic title and leans on the raw message, which the card shows verbatim.
 * See docs/changes/06-state-surfaces.md
 */
export type ErrorKind =
    | 'unauthorized'
    | 'no-device'
    | 'adb-missing'
    | 'server-push'
    | 'stream-ended'
    | 'unknown';

interface ErrorCopy {
    title: string;
    hint: string;
}

const COPY: Record<ErrorKind, ErrorCopy> = {
    unauthorized: {
        title: 'Device not authorised',
        hint: 'Unlock the device and accept the "Allow USB debugging" prompt, then retry.',
    },
    'no-device': {
        title: 'No device found',
        hint: 'Connect a device over USB with USB debugging enabled in Developer Options.',
    },
    'adb-missing': {
        title: 'ADB not found',
        hint: 'Install the Android platform-tools and make sure `adb` is on your PATH.',
    },
    'server-push': {
        title: 'Could not install the scrcpy server',
        hint: 'The device rejected the server push. Restarting the adb server usually clears this.',
    },
    'stream-ended': {
        title: 'Mirroring stopped',
        hint: 'The video stream ended. This happens when the device sleeps, is unplugged, or another scrcpy takes over.',
    },
    unknown: {
        title: 'Could not start mirroring',
        hint: 'Retry, or run the checks below to see what adb reports.',
    },
};

// Ordered: the first pattern that matches wins, so the specific causes are
// tested before the broad "stream ended" wording.
const PATTERNS: [ErrorKind, RegExp][] = [
    ['unauthorized', /unauthori[sz]ed|authori[sz]e the connection|device unauthorized/i],
    ['adb-missing', /adb.*(not found|enoent|no such file)|spawn adb|cannot find adb/i],
    ['no-device', /no android device|no devices?\b.*found|device (not found|offline)/i],
    ['server-push', /push.*server|scrcpy-server|server.*push failed/i],
    ['stream-ended', /stream (ended|closed|aborted)|connection (closed|lost)|disconnected/i],
];

export function classifyError(message: string): ErrorKind {
    for (const [kind, pattern] of PATTERNS) {
        if (pattern.test(message)) {
            return kind;
        }
    }
    return 'unknown';
}

export function errorCopy(kind: ErrorKind): ErrorCopy {
    return COPY[kind];
}
