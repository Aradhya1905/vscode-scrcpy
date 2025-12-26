const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function run(cmd, cwd = root) {
    console.log(`\n> ${cmd}\n`);
    execSync(cmd, { cwd, stdio: 'inherit' });
}

function clean(dir) {
    const fullPath = path.join(root, dir);
    if (fs.existsSync(fullPath)) {
        console.log(`Cleaning ${dir}...`);
        fs.rmSync(fullPath, { recursive: true, force: true });
    }
}

function removeVsixFiles() {
    const files = fs.readdirSync(root);
    files.forEach(file => {
        if (file.endsWith('.vsix')) {
            console.log(`Removing old ${file}...`);
            fs.unlinkSync(path.join(root, file));
        }
    });
}

console.log('========================================');
console.log('  Building VS Code Scrcpy Extension');
console.log('========================================\n');

// Step 1: Clean old build artifacts
console.log('Step 1: Cleaning old build artifacts...');
clean('dist');
clean('out');
clean('webview-ui/dist');
removeVsixFiles();

// Step 2: Type check
console.log('\nStep 2: Type checking...');
run('npm run typecheck');

// Step 3: Bundle extension (minified)
console.log('\nStep 3: Bundling extension...');
run('npm run bundle -- --minify');

// Step 4: Build webview
console.log('\nStep 4: Building webview...');
run('npm run compile:webview');

// Step 5: Package VSIX
console.log('\nStep 5: Packaging VSIX...');
run('npm run package:vsix');

console.log('\n========================================');
console.log('  Build complete! VSIX file is ready.');
console.log('========================================\n');
