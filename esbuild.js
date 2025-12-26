const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const minify = args.has('--minify');

async function main() {
    fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });

    if (minify) {
        const mapPath = path.join(__dirname, 'dist', 'extension.js.map');
        try {
            fs.unlinkSync(mapPath);
        } catch {
            // ignore
        }
    }

    const buildOptions = {
        entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
        outfile: path.join(__dirname, 'dist', 'extension.js'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        sourcemap: !minify,
        external: ['vscode'],
        legalComments: 'none',
        minify,
    };

    if (watch) {
        console.log('ESBUILD_WATCH_START');
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('ESBUILD_WATCH_READY');
        return;
    }

    await esbuild.build(buildOptions);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
