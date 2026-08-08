import { spawn } from 'child_process';
import { AdbPathResolver } from './AdbPathResolver';

export interface AdbCommandResult {
    stdout: string;
    stderr: string;
    /** The device command's exit code, or the adb client's when it never ran. */
    exitCode: number;
}

/**
 * The part of a live `@yume-chan/adb` handle this module uses.
 *
 * Declared structurally on purpose: nothing here imports the protocol stack, so a
 * service that only needs to run a shell command never drags ~267 KB of scrcpy
 * code into its module graph. `ScrcpyService` passes its real `Adb` instance,
 * which satisfies this shape.
 */
export interface AdbSocketHandle {
    subprocess: {
        noneProtocol: {
            spawnWaitText(command: readonly string[]): Promise<string>;
        };
        /** Absent on devices predating the shell v2 protocol - no exit code there. */
        shellProtocol?: {
            spawnWaitText(command: readonly string[]): Promise<AdbCommandResult>;
        };
    };
}

interface SocketRegistration {
    deviceId: string;
    handle: AdbSocketHandle;
}

/**
 * Single entry point for one-shot ADB commands, over whichever transport is
 * available.
 *
 * Every command used to be its own `spawn('adb', ...)`: a process, a PATH lookup,
 * a new TCP connection to the ADB server and a fresh device handshake, for output
 * that is usually a few hundred bytes. When a mirror session is live there is
 * already an authenticated connection to that exact device sitting idle between
 * video packets, and the ADB protocol multiplexes streams over it - so the same
 * command costs one stream and no process at all.
 *
 * The backend is chosen per call and never retried across backends: a command
 * that failed over the socket may well have run, and re-running `rm -rf` or
 * `monkey` on the spawn path would be worse than the error.
 */
export class AdbCommandRunner {
    /**
     * Live device handles, keyed by nothing - a Set, because both the sidebar and
     * the floating panel can own a session, possibly for different devices.
     */
    private static readonly sockets = new Set<SocketRegistration>();

    /**
     * Publishes a live device handle for the duration of a mirror session.
     * Returns the unregister function; callers must call it when the session ends,
     * or every later command will be attempted over a dead socket.
     */
    static registerSocket(deviceId: string, handle: AdbSocketHandle): () => void {
        const registration: SocketRegistration = { deviceId, handle };
        this.sockets.add(registration);
        return () => {
            this.sockets.delete(registration);
        };
    }

    /** True when `deviceId` can currently be reached without spawning a process. */
    static hasSocket(deviceId: string): boolean {
        return this.findSocket(deviceId) !== null;
    }

    /**
     * Runs a command in the device shell and returns its trimmed stdout, throwing
     * if it failed.
     *
     * `command` is the shell command only - no leading `shell`, no `-s <device>`.
     * Its elements are joined with spaces by both backends, exactly as the adb CLI
     * does, so a single element containing pipes or `;` behaves as written.
     */
    static async shell(
        deviceId: string,
        command: readonly string[],
        timeoutMs?: number
    ): Promise<string> {
        const result = await this.shellDetailed(deviceId, command, timeoutMs);
        if (result.exitCode !== 0) {
            throw new Error(result.stderr.trim() || `Command failed with code ${result.exitCode}`);
        }
        return result.stdout.trim();
    }

    /**
     * Same as `shell`, but reports a failing command through `exitCode` instead of
     * throwing - for callers that display stderr rather than treating it as an
     * error, like the shell console.
     */
    static async shellDetailed(
        deviceId: string,
        command: readonly string[],
        timeoutMs?: number
    ): Promise<AdbCommandResult> {
        const socket = this.findSocket(deviceId);
        if (socket) {
            return this.shellOverSocket(socket, command, timeoutMs);
        }
        return this.spawnAdb(['-s', deviceId, 'shell', ...command], timeoutMs);
    }

    /**
     * Runs an adb subcommand that is not a device shell - `pull`, `install`,
     * `logcat -c`. These speak their own protocols on top of the connection rather
     * than opening a shell, so they always take the spawn path.
     */
    static async adb(
        deviceId: string,
        args: readonly string[],
        timeoutMs?: number
    ): Promise<AdbCommandResult> {
        return this.spawnAdb(['-s', deviceId, ...args], timeoutMs);
    }

    /**
     * Runs an adb subcommand with no device scope - `devices`, `kill-server`. The
     * diagnostics that use these have to run when no device is reachable, so there
     * is no socket to ride and no `-s` to pass: always spawn.
     */
    static async host(args: readonly string[], timeoutMs?: number): Promise<AdbCommandResult> {
        return this.spawnAdb(args, timeoutMs);
    }

    private static findSocket(deviceId: string): AdbSocketHandle | null {
        for (const registration of this.sockets) {
            if (registration.deviceId === deviceId) {
                return registration.handle;
            }
        }
        return null;
    }

    private static async shellOverSocket(
        handle: AdbSocketHandle,
        command: readonly string[],
        timeoutMs: number | undefined
    ): Promise<AdbCommandResult> {
        const label = command.join(' ');
        const shellProtocol = handle.subprocess.shellProtocol;

        if (shellProtocol) {
            return this.withTimeout(shellProtocol.spawnWaitText(command), timeoutMs, label);
        }

        // Shell v1: one merged output stream and no exit status - the same
        // information the adb CLI has against these devices. Reporting success is
        // the honest answer, since failure is indistinguishable from output.
        const stdout = await this.withTimeout(
            handle.subprocess.noneProtocol.spawnWaitText(command),
            timeoutMs,
            label
        );
        return { stdout, stderr: '', exitCode: 0 };
    }

    /**
     * Rejects only when adb itself could not run or the command outlived its
     * timeout; a non-zero exit is reported in the result, so callers decide.
     */
    private static spawnAdb(
        args: readonly string[],
        timeoutMs: number | undefined
    ): Promise<AdbCommandResult> {
        return new Promise((resolve, reject) => {
            const adb = spawn(AdbPathResolver.getAdbCommand(), [...args], {
                windowsHide: true,
            });

            // Package dumps run to several MB; collecting chunks and concatenating
            // once avoids the quadratic cost of repeated string concatenation.
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            let settled = false;

            const timer =
                timeoutMs === undefined
                    ? null
                    : setTimeout(() => {
                          if (settled) {
                              return;
                          }
                          settled = true;
                          adb.kill();
                          reject(
                              new Error(
                                  `ADB command timed out after ${timeoutMs}ms: ${args.join(' ')}`
                              )
                          );
                      }, timeoutMs);

            const finish = (fn: () => void) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timer) {
                    clearTimeout(timer);
                }
                fn();
            };

            adb.stdout.on('data', (data: Buffer) => stdoutChunks.push(data));
            adb.stderr.on('data', (data: Buffer) => stderrChunks.push(data));

            adb.on('close', (code) => {
                finish(() =>
                    resolve({
                        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                        stderr: Buffer.concat(stderrChunks).toString('utf8'),
                        exitCode: code ?? 0,
                    })
                );
            });

            adb.on('error', (err) => {
                finish(() => reject(new Error(`ADB command error: ${err.message}`)));
            });
        });
    }

    /**
     * Bounds a socket command the way `kill()` bounds a spawned one.
     *
     * The loser of the race is still awaited internally, so a late rejection stays
     * handled; the device-side process is left to finish on its own, exactly as it
     * is when the adb client is killed.
     */
    private static async withTimeout<T>(
        work: Promise<T>,
        timeoutMs: number | undefined,
        label: string
    ): Promise<T> {
        if (timeoutMs === undefined) {
            return work;
        }

        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                work,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error(`ADB command timed out after ${timeoutMs}ms: ${label}`)
                            ),
                        timeoutMs
                    );
                }),
            ]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
}
