import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { AdbPathResolver } from './AdbPathResolver';

export interface DeviceFsEntry {
    name: string;
    path: string;
    isDir: boolean;
}

function normalizeRemotePath(p: string): string {
    const raw = (p || '').trim().replace(/\\/g, '/');
    if (!raw) return '/';
    if (raw === '/') return '/';
    const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
    // Collapse multiple slashes + remove trailing slash (except root)
    const collapsed = withLeading.replace(/\/{2,}/g, '/');
    return collapsed.length > 1 ? collapsed.replace(/\/+$/g, '') : collapsed;
}

function joinRemotePath(parent: string, child: string): string {
    const p = normalizeRemotePath(parent);
    const c = (child || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!c) return p;
    if (p === '/') return `/${c}`;
    return `${p}/${c}`;
}

export class DeviceFileService {
    async listDir(deviceId: string, dirPath: string): Promise<DeviceFsEntry[]> {
        const normalizedPath = normalizeRemotePath(dirPath);

        // Use direct `adb shell ls ... <path>` instead of `sh -c` positional args.
        // Some Android shells/devices behave inconsistently with `sh -c ... _ "$1"` which can lead to listing `/`.
        const output = await this.runAdb(deviceId, ['shell', 'ls', '-a', '-p', normalizedPath]);

        const names = output
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => !!l && l !== '.' && l !== '..');

        const entries: DeviceFsEntry[] = names.map((rawName) => {
            const isDir = rawName.endsWith('/');
            const name = isDir ? rawName.slice(0, -1) : rawName;
            return {
                name,
                isDir,
                path: joinRemotePath(normalizedPath, name),
            };
        });

        // Sort: directories first, then alphabetical
        entries.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        return entries;
    }

    /**
     * Pull a file from the device to a local path.
     * Note: remotePath must be an absolute device path (e.g. /sdcard/DCIM/..).
     */
    async pullFile(deviceId: string, remotePath: string, localPath: string): Promise<void> {
        const rp = (remotePath || '').trim();
        if (!rp) {
            throw new Error('Missing remote path');
        }
        await this.runAdbVoid(deviceId, ['pull', rp, localPath]);
    }

    /**
     * Delete a file (or directory if isDir=true) on the device.
     */
    async deletePath(deviceId: string, remotePath: string, isDir: boolean): Promise<void> {
        const rp = (remotePath || '').trim();
        if (!rp) {
            throw new Error('Missing remote path');
        }
        if (rp === '/' || rp === '/sdcard') {
            throw new Error('Refusing to delete protected path');
        }

        if (isDir) {
            await this.runAdbVoid(deviceId, ['shell', 'rm', '-rf', '--', rp]);
        } else {
            await this.runAdbVoid(deviceId, ['shell', 'rm', '-f', '--', rp]);
        }
    }

    static makeCacheFileName(remotePath: string): string {
        const rawBase = path.posix.basename(remotePath.replace(/\\/g, '/')) || 'file';
        // Sanitize for Windows/macOS/Linux filenames
        const base = rawBase.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'file';
        const hash = crypto.createHash('sha1').update(remotePath).digest('hex').slice(0, 10);
        // Preserve extension to ensure OS file associations work (images/videos/etc).
        const ext = path.posix.extname(base);
        const stem = ext ? base.slice(0, -ext.length) : base;
        return `${stem}-${hash}${ext}`;
    }

    private runAdb(deviceId: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const adb = spawn(AdbPathResolver.getAdbCommand(), ['-s', deviceId, ...args], {
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';

            adb.stdout.on('data', (d) => (stdout += d.toString()));
            adb.stderr.on('data', (d) => (stderr += d.toString()));

            adb.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error((stderr || stdout || 'ADB command failed').trim()));
                }
            });

            adb.on('error', (err) => {
                reject(err);
            });
        });
    }

    private runAdbVoid(deviceId: string, args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const adb = spawn(AdbPathResolver.getAdbCommand(), ['-s', deviceId, ...args], {
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';

            adb.stdout.on('data', (d) => (stdout += d.toString()));
            adb.stderr.on('data', (d) => (stderr += d.toString()));

            adb.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error((stderr || stdout || 'ADB command failed').trim()));
                }
            });

            adb.on('error', (err) => reject(err));
        });
    }
}
