import { spawn } from 'child_process';
import { AdbPathResolver } from './AdbPathResolver';

export interface ApkInstallResult {
    stdout: string;
    stderr: string;
    command: string;
}

function runAdb(deviceId: string, args: string[]): Promise<ApkInstallResult> {
    return new Promise((resolve, reject) => {
        const fullArgs = ['-s', deviceId, ...args];
        const adb = spawn(AdbPathResolver.getAdbCommand(), fullArgs, { windowsHide: true });

        let stdout = '';
        let stderr = '';

        adb.stdout?.on('data', (d) => {
            stdout += d.toString();
        });
        adb.stderr?.on('data', (d) => {
            stderr += d.toString();
        });

        adb.on('error', (err) => reject(err));
        adb.on('close', (code) => {
            const command = `adb ${fullArgs.join(' ')}`;
            if (code === 0) {
                resolve({ stdout, stderr, command });
            } else {
                reject(
                    new Error(`${stderr || stdout || 'adb command failed'}\n\nCommand: ${command}`)
                );
            }
        });
    });
}

export async function installApks(deviceId: string, apkPaths: string[]): Promise<ApkInstallResult> {
    const files = (apkPaths || []).filter(Boolean);
    if (files.length === 0) {
        throw new Error('No APK files selected.');
    }

    // Single APK (standard install)
    if (files.length === 1) {
        return await runAdb(deviceId, ['install', '-r', files[0]]);
    }

    // Multiple APKs: try split install first; if that fails, fallback to sequential installs.
    try {
        return await runAdb(deviceId, ['install-multiple', '-r', ...files]);
    } catch (err) {
        // Fallback: sequential installs (best effort)
        let combinedStdout = '';
        let combinedStderr = '';
        let lastCommand = '';

        for (const f of files) {
            const r = await runAdb(deviceId, ['install', '-r', f]);
            combinedStdout += r.stdout;
            combinedStderr += r.stderr;
            lastCommand = r.command;
        }

        return { stdout: combinedStdout, stderr: combinedStderr, command: lastCommand };
    }
}
