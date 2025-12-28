# VS Code Scrcpy

## Overview

- **Type**: VS Code Extension with React Webview UI
- **Stack**: TypeScript 5.3, React 18, Vite 6, ESBuild, VS Code Extension API
- **Purpose**: Mirror Android device screens directly in VS Code with touch controls, file management, and ADB tools
- **Architecture**: Extension (Node.js) + Webview UI (React/browser)

This CLAUDE.md is the authoritative source for development guidelines.
Subdirectory CLAUDE.md files extend these rules with specific context.

---

## Universal Development Rules

### Code Quality (MUST)

- **MUST** write TypeScript in strict mode (enabled in both tsconfigs)
- **MUST** use 4-space indentation (Prettier config)
- **MUST** use single quotes for strings
- **MUST** include trailing commas (ES5 style)
- **MUST** run `npm run typecheck` before committing
- **MUST** run `npm run format` to ensure consistent formatting
- **MUST NOT** commit secrets, API keys, or device-specific data

### Best Practices (SHOULD)

- **SHOULD** use functional React components with hooks (no class components)
- **SHOULD** use `memo()` for components receiving callback props
- **SHOULD** co-locate related code (component + hook + styles)
- **SHOULD** use descriptive variable names (no single letters except loops/lambdas)
- **SHOULD** keep functions under 50 lines when possible
- **SHOULD** extract complex logic into service classes or hooks

### Anti-Patterns (MUST NOT)

- **MUST NOT** use `any` type without explicit justification in comments
- **MUST NOT** bypass TypeScript errors with `@ts-ignore` or `@ts-expect-error`
- **MUST NOT** use `console.log` in production code (use VS Code output channels)
- **MUST NOT** hardcode device IDs or ADB paths
- **MUST NOT** block the main thread with synchronous file operations in extension

---

## Core Commands

### Development

```bash
# Install all dependencies (root + webview-ui)
npm run install:all

# Compile everything (extension + webview)
npm run compile

# Watch mode for extension development
npm run watch

# Watch mode for webview UI development
npm run watch:webview

# Type checking
npm run typecheck

# Lint code
npm run lint

# Format code
npm run format

# Check formatting without changes
npm run format:check
```

### Building & Packaging

```bash
# Full production build (clean + typecheck + bundle + webview + VSIX)
npm run build

# Bundle extension only (minified)
npm run bundle -- --minify

# Compile webview only
npm run compile:webview

# Package VSIX for distribution
npm run package:vsix
```

### Quality Gates (run before PR)

```bash
npm run typecheck && npm run lint && npm run format:check
```

---

## Project Structure

### Extension Source (`src/`)

- **[extension.ts](src/extension.ts)** - Main entry point, command registration
- **[services/](src/services/)** - Core business logic
  - `ScrcpyService.ts` - Screen mirroring via @yume-chan/scrcpy
  - `DeviceManager.ts` - ADB device discovery and selection
  - `AdbShellService.ts` - Shell command execution
  - `DeviceInfoService.ts` - Device metadata (battery, storage, etc.)
  - `AppManager.ts` - Installed apps, launch apps
  - `DeviceFileService.ts` - File operations on device
  - `ApkInstaller.ts` - APK installation
  - `AdbLogcatService.ts` - Logcat streaming
  - `AdbPathResolver.ts` - Cross-platform ADB path detection
- **[panels/](src/panels/)** - Webview panel definitions
  - `ScrcpyPanel.ts` - Floating mirror panel
  - `FileManagerPanel.ts` - Device file browser
  - `ShellLogsPanel.ts` - ADB shell interface
  - `LogcatPanel.ts` - Logcat viewer
- **[views/](src/views/)** - Sidebar view providers
  - `ScrcpySidebarView.ts` - Main sidebar with mirror + controls

See [src/CLAUDE.md](src/CLAUDE.md) for detailed extension patterns.

### Webview UI (`webview-ui/`)

- **[src/apps/](webview-ui/src/apps/)** - Full-page applications
  - `MirrorApp.tsx` - Screen mirroring view
  - `FileManagerApp.tsx` - File browser view
  - `LogcatApp.tsx` - Logcat viewer
  - `ShellLogsApp.tsx` - Shell output viewer
- **[src/components/](webview-ui/src/components/)** - Reusable UI components
  - `VideoCanvas.tsx` - WebGL video rendering + touch handling
  - `Toolbar.tsx` - Control buttons
  - `DeviceSelector.tsx` - Device picker dropdown
  - `SettingsPanel.tsx` - Quality/FPS settings
- **[src/hooks/](webview-ui/src/hooks/)** - Custom React hooks
  - `useVideoDecoder.ts` - H.264 WebCodecs decoding
  - `useVSCodeMessages.ts` - Extension ↔ webview messaging
  - `useKeyboard.ts` - Keyboard event handling
  - `useSettingsStorage.ts` - Persistent settings
- **[src/styles/](webview-ui/src/styles/)** - CSS stylesheets (15 files)

See [webview-ui/CLAUDE.md](webview-ui/CLAUDE.md) for detailed React patterns.

### Build & Configuration

- **[esbuild.js](esbuild.js)** - Extension bundler configuration
- **[scripts/build.js](scripts/build.js)** - Full build orchestration
- **[webview-ui/vite.config.ts](webview-ui/vite.config.ts)** - Webview bundler
- **[tsconfig.json](tsconfig.json)** - Extension TypeScript config (CommonJS, Node)
- **[webview-ui/tsconfig.json](webview-ui/tsconfig.json)** - Webview TypeScript config (ESNext, React)

### Assets

- **[assets/scrcpy-server](assets/scrcpy-server)** - Scrcpy server binary (pushed to device)
- **[media/](media/)** - Compiled webview output + static HTML
- **[images/](images/)** - Extension icons and screenshots

---

## Quick Find Commands

### Code Navigation

```bash
# Find a service class
rg -n "^export class.*Service" src/services/

# Find a React component
rg -n "^export (const|function) \w+ = (memo\()?function" webview-ui/src/components/

# Find a custom hook
rg -n "^export function use[A-Z]" webview-ui/src/hooks/

# Find webview message handlers
rg -n "case '[a-z-]+'" src/views/

# Find VS Code command registrations
rg -n "registerCommand" src/extension.ts
```

### Type Definitions

```bash
# Find interfaces
rg -n "^(export )?interface \w+" src/ webview-ui/src/

# Find type aliases
rg -n "^(export )?type \w+ =" src/ webview-ui/src/
```

### Debugging

```bash
# Find console.log statements (should be minimal)
rg -n "console\.(log|warn|error)" src/ webview-ui/src/

# Find TODO comments
rg -n "TODO|FIXME|HACK" src/ webview-ui/src/
```

---

## Security Guidelines

### Secrets Management

- **NEVER** commit tokens, API keys, or credentials
- ADB authentication is handled by the OS (adb server)
- Device-specific data stays on device

### ADB Safety

- Always validate device IDs before operations
- Use timeout for shell commands to prevent hangs
- Catch and handle ADB connection errors gracefully
- Never run destructive commands (factory reset, wipe) without explicit user confirmation

### Webview Security

- CSP (Content Security Policy) is enforced in webview HTML
- Only load scripts from extension resources
- Validate all messages from webview before acting on them

---

## Git Workflow

- Branch from `main` for features: `feature/description`
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- PRs require: passing typecheck, lint, and format:check
- Keep commits focused and atomic
- Delete branches after merge

### Commit Message Examples

```
feat: add dark mode toggle for device screen
fix: handle ADB connection timeout gracefully
refactor: extract video buffering logic to separate class
docs: update README with new file manager feature
chore: update @yume-chan/adb to latest version
```

---

## Testing Strategy

> ⚠️ **Testing infrastructure is not yet implemented.**

When adding tests:
- Use Vitest for both extension and webview
- Co-locate unit tests with source (`*.test.ts`)
- Mock VS Code API using `@vscode/test-electron` or manual mocks
- Mock ADB interactions for service tests

---

## VS Code Extension Specifics

### Activation Events

Extension activates on:
- `onView:scrcpySidebar` - When sidebar is visible
- `onCommand:vscode-scrcpy.startMirror` - Start mirror command
- `onCommand:vscode-scrcpy.stopMirror` - Stop mirror command
- `onCommand:vscode-scrcpy.openFileManager` - File manager command
- `onCommand:vscode-scrcpy.openShellLogs` - Shell logs command
- `onCommand:vscode-scrcpy.openLogcat` - Logcat command

### Extension ↔ Webview Communication

Messages flow via `postMessage`:
- Extension → Webview: `{ type: 'video' | 'connected' | 'device-list' | ... }`
- Webview → Extension: `{ command: 'start' | 'stop' | 'touch' | ... }`

See [src/views/ScrcpySidebarView.ts:157](src/views/ScrcpySidebarView.ts#L157) for message handler.

### Debugging

1. Press F5 in VS Code to launch Extension Development Host
2. Open the "Android Screen Mirror" sidebar
3. Check "Output" panel > "Extension Host" for logs
4. Use Chrome DevTools for webview debugging (Cmd+Shift+P → "Developer: Open Webview Developer Tools")

---

## Available Tools

You have access to:
- Standard bash tools (git, npm, node, rg, etc.)
- ADB CLI (`adb`) for device interactions
- VS Code Extension CLI (`vsce`) for packaging
- GitHub CLI (`gh`) for issues, PRs, releases (if installed)

### Tool Permissions

- ✅ Read any file
- ✅ Write code files (src/, webview-ui/src/)
- ✅ Run typecheck, lint, format, compile
- ✅ Run npm install
- ⚠️ Build and package VSIX (creates distributable)
- ❌ Edit .env files (ask first)
- ❌ Force push (ask first)
- ❌ Run ADB commands on physical devices (ask first)

---

## Key Dependencies

### Extension (@yume-chan packages)

- `@yume-chan/adb` - TypeScript ADB client
- `@yume-chan/adb-scrcpy` - Scrcpy protocol implementation
- `@yume-chan/scrcpy` - Scrcpy types and constants
- `@yume-chan/adb-server-node-tcp` - ADB server TCP connector
- `@yume-chan/stream-extra` - Stream utilities

### Webview

- `react` / `react-dom` - UI framework
- `lucide-react` - Icon library

### Build Tools

- `esbuild` - Extension bundler
- `vite` - Webview bundler
- `typescript` - Type checking
- `eslint` - Linting
- `prettier` - Formatting

---

## Specialized Context

When working in specific directories, refer to their CLAUDE.md:
- Extension development: [src/CLAUDE.md](src/CLAUDE.md)
- React UI development: [webview-ui/CLAUDE.md](webview-ui/CLAUDE.md)

These files provide detailed, context-specific patterns and examples.
