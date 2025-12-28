# Build Extension

Run the complete build process for the VS Code Scrcpy extension.

## Steps

1. Run the full build script which:
   - Cleans old build artifacts (dist/, out/, webview-ui/dist/, *.vsix)
   - Type checks all TypeScript code
   - Bundles the extension (minified)
   - Builds the webview React UI
   - Packages the VSIX file

```bash
npm run build
```

2. Report any errors encountered during the build process.

3. If successful, list the generated VSIX file and its size.

## Expected Output

- Clean build artifacts removed
- TypeScript compilation successful
- Extension bundled to dist/extension.js
- Webview built to media/build/
- VSIX file created (vscode-scrcpy-*.vsix)
