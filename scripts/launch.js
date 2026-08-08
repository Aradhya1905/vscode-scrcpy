/**
 * Launches the Extension Development Host from the command line.
 *
 *   node ./scripts/launch.js            # normal run
 *   node ./scripts/launch.js --debug    # run with the extension host debugger
 *
 * Set VSCODE_CLI to use a different editor binary (e.g. VSCODE_CLI=cursor).
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cli = process.env.VSCODE_CLI || 'code';
const debugPort = process.env.DEBUG_PORT || '9229';

const isDebug = process.argv.includes('--debug');
const passthrough = process.argv.slice(2).filter((arg) => arg !== '--debug');

// extensionDevelopmentPath must be absolute - the CLI does not resolve relative paths
const args = [`--extensionDevelopmentPath=${root}`, '--new-window'];

if (isDebug) {
    args.push(`--inspect-extensions=${debugPort}`);
}

args.push(...passthrough);

console.log(`\n> ${cli} ${args.join(' ')}\n`);

if (isDebug) {
    console.log(`Extension host debugger listening on port ${debugPort}.`);
    console.log('Attach from VS Code: Run and Debug > "Attach to Extension Host".\n');
}

// shell: true so Windows resolves code.cmd / cursor.cmd from PATH
const child = spawn(cli, args, { cwd: root, stdio: 'inherit', shell: true });

child.on('error', (error) => {
    console.error(`\nFailed to start "${cli}": ${error.message}`);
    console.error('Make sure the editor CLI is on your PATH.');
    console.error('In VS Code: Ctrl+Shift+P > "Shell Command: Install \'code\' command in PATH".\n');
    process.exit(1);
});

child.on('exit', (code) => {
    if (code !== 0) {
        console.error(`\n"${cli}" exited with code ${code}.`);
        console.error(`If the command was not found, ensure "${cli}" is on your PATH.\n`);
    }
    process.exit(code ?? 0);
});
