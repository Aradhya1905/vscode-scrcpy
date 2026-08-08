# MCP server / CLI for LLM-driven device control

**Researched:** 2026-08-08
**Status:** feasible, nothing built
**Question asked:** can an LLM drive this extension — "open it, click some things,
take screenshots or video, and report back"?

**Short answer:** yes. Three tiers are all viable, and VS Code has a first-class
API for publishing an MCP server from an extension. The recommended shape is a
pure-Node core extracted from the existing services, with a CLI and an MCP server
as thin wrappers, and the extension registering the MCP server with VS Code.

---

## 1. What VS Code provides

VS Code exposes `vscode.lm.registerMcpServerDefinitionProvider(providerId, provider)`.
An extension that calls it during activation can publish MCP servers to the
editor's chat/agent surface, alongside the ones a user configures by hand.

The extension must also declare the provider in `package.json`:

```json
{
  "contributes": {
    "mcpServerDefinitionProviders": [
      { "id": "vscodeScrcpy", "label": "VS Code Scrcpy — Android device" }
    ]
  }
}
```

The `id` must match the one passed to the API call.

The provider object supplies:

- `provideMcpServerDefinitions()` — returns the server definitions
- `resolveMcpServerDefinition(server)` — optional, called just before a server
  starts; the documented place to do auth or other setup
- `onDidChangeMcpServerDefinitions` — fire when the set of servers changes
  (e.g. a device was plugged in or unplugged)

By default the editor invokes the provider to discover servers and tools when a
chat message is submitted.

Two definition types:

| Type | Transport | Runs where |
|------|-----------|-----------|
| `McpStdioServerDefinition` | a local process, over stdin/stdout | separate process |
| `McpHttpServerDefinition` | Streamable HTTP | anywhere reachable, including a port opened by the extension host |

The distinction matters for the design choice in section 4.

### Caveats found

- The docs do not state a minimum `engines.vscode`. This extension currently
  declares `^1.85.0`; the MCP API is considerably newer, so the engine floor
  will have to rise. **Verify the exact minimum before building.**
- Cursor does not implement this API — there is an open community request for
  it. If Cursor support matters (the codebase already has Cursor-specific CSS
  workarounds in `base.css`, so it plausibly does), the stdio server must also
  be usable via a plain `mcp.json` entry, not only via the VS Code provider API.

## 2. Prior art

The space is already occupied, which is useful both as a reference and as a
warning not to rebuild it badly.

- **`scrcpy-mcp`** (JuanCF) — the closest thing to this idea. ~34 tools covering
  screenshots, input, apps, UI automation, shell, files, and clipboard. Uses
  scrcpy's binary control protocol for input and screenshots (reported ~33 ms
  per screenshot, 10–50× faster than shelling out), with an ADB fallback for
  every tool. Connects to any MCP client — Claude Code, Cursor, VS Code Copilot.
- **`android-mcp-server`** (minhalvp) — ADB-focused: screenshots, UI layout
  analysis, package management, arbitrary ADB commands.
- **"Android MCP"** (mcpmarket listing) — FastMCP-based, device management, app
  install, file ops, shell, screen input, system info, scrcpy mirroring, UI
  element finding.

**Differentiation:** none of these is a VS Code extension. The thing this
project can do that they cannot is put the agent and the human in the same
window — the agent drives the device while the developer watches the live mirror
in the sidebar, with logcat and the file manager already there. That, not tool
count, is the reason to build it.

## 3. How much of this codebase is reusable

Checked directly. Most of the device layer is already free of VS Code:

| Module | Imports `vscode`? | Notes |
|--------|-------------------|-------|
| `services/ScrcpyService.ts` | **No** | only `fs`, `path`, `@yume-chan/*`. Lifts out as-is. |
| `services/ApkInstaller.ts` | No | |
| `services/AppManager.ts` | No | |
| `services/DeviceFileService.ts` | No | |
| `services/DeviceInfoService.ts` | No | |
| `services/AdbPathResolver.ts` | No | |
| `services/DeviceManager.ts` | Yes | only for `ExtensionContext` state (device preference) |
| `services/AdbShellService.ts` | Yes | only for `ExtensionContext` |
| `services/AdbLogcatService.ts` | Yes | only for `ExtensionContext` |

The three that do import `vscode` use it for persistence, not behaviour.
Injecting a small `KeyValueStore` interface (backed by `globalState` in the
extension, by a JSON file in the CLI) decouples them.

Also already implemented and directly reusable as MCP tools:

- `ScrcpyService.captureScreenshot()` — `screencap -p`, returns a PNG buffer
- `ScrcpyService.sendTouchEvent()` / `sendKeyEvent()` / `sendScroll()`
- `ScrcpyService.pasteText()` — `setClipboard` with `paste: true`
- `ScrcpyService.launchApp()`
- `AdbShellService.executeCommand()`
- `AppManager` — installed apps, recent apps, debuggable apps
- `DeviceFileService` — push/pull/delete
- `AdbLogcatService` — streaming logcat

## 4. Proposed architecture

```
packages/core/     pure Node. ScrcpyService, adb shell, device management,
                   app/file/logcat services. No vscode import. KeyValueStore
                   injected.
packages/cli/      bin: devices | mirror | screenshot | tap | swipe | text |
                   key | shell | record | install
packages/mcp/      MCP stdio server wrapping core
extension/         imports core; registers the MCP server via
                   contributes.mcpServerDefinitionProviders
```

### Two designs for "click a button in the extension and report back"

**Design A — the MCP server talks to the device directly.** *Recommended.*
It does not care whether the sidebar is open, there is no IPC, and it works
identically when launched from Claude Code or a terminal with no VS Code
running. Ships as `McpStdioServerDefinition`.

**Design B — the MCP server proxies into the running extension** over a
localhost HTTP port the extension host opens, published as
`McpHttpServerDefinition`. Only worth it if the agent needs to drive *extension*
state rather than device state: open the File Manager panel, change the zoom
level, capture what the webview is rendering including the device skin.

Start with A. Add B later as an extra set of tools if the "drive the UI" use
case turns out to matter — the two are not exclusive, since a single provider
can return more than one server definition.

Note that if the goal is for the model to *see* the device, `screencap` is the
better source than the webview canvas: higher fidelity, no skin or zoom
transform baked in, and it works while the sidebar is closed.

### Video

**MCP has no video content type.** Two workable options:

1. Record to a file and return the path. Good for a human to open afterwards,
   useless to the model itself.
2. Return N sampled frames as image content — a contact sheet of the
   interaction.

Option 2 is what agents actually consume, and it is what makes "report back
whatever video you take" achievable in practice. Both can be offered:
`record_start` / `record_stop` returning a path, plus a `frames` parameter that
also returns sampled stills.

### Safety

An MCP tool that runs arbitrary `adb shell` is remote code execution on a
physical device, initiated by a model. The existing `CLAUDE.md` security section
already says never to run destructive commands without explicit confirmation —
that rule needs teeth here:

- allowlist the safe read-only verbs (`getprop`, `dumpsys`, `pm list`, `ls`, `cat`)
- require an explicit confirmation argument for anything mutating
  (`pm uninstall`, `rm`, `settings put`, `am force-stop`, factory reset)
- never expose a raw passthrough tool without that gate
- scope every tool to an explicit device serial; refuse to guess when more than
  one device is attached

## 5. Rough tool surface

| Tool | Backed by |
|------|-----------|
| `list_devices` | `DeviceManager` |
| `screenshot` | `ScrcpyService.captureScreenshot()` → PNG image content |
| `tap` / `swipe` / `scroll` | `sendTouchEvent` / `sendScroll` |
| `type_text` | `pasteText` |
| `press_key` | `sendKeyEvent` (HOME=3, BACK=4, APP_SWITCH=187) |
| `launch_app` / `list_apps` | `AppManager` |
| `ui_dump` | `uiautomator dump` — also unlocks the layout inspector feature |
| `shell` | `AdbShellService`, allowlisted |
| `install_apk` | `ApkInstaller` |
| `push_file` / `pull_file` | `DeviceFileService` |
| `logcat` | `AdbLogcatService`, with a filter and a line cap |
| `record_start` / `record_stop` | new; H.264 stream muxed to MP4 |

## 6. Effort estimate

| Piece | Estimate |
|-------|----------|
| Extract `packages/core`, inject `KeyValueStore` | ~1 day |
| CLI | ~1 day |
| MCP stdio server | ~2 days |
| VS Code MCP registration | ~2 hours |

Sequencing note: the core extraction is worth doing on its own merits even if
the MCP work is never started. It removes the `vscode` import from three
services, makes them testable without an extension host, and is a prerequisite
for the audio and recording features in the backlog.

---

## Sources

- [MCP developer guide — VS Code Extension API](https://code.visualstudio.com/api/extension-guides/ai/mcp)
- [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api)
- [microsoft/vscode#243522 — API to allow extensions to publish collections of MCP servers](https://github.com/microsoft/vscode/issues/243522)
- [JuanCF/scrcpy-mcp](https://github.com/juancf/scrcpy-mcp)
- [scrcpy-mcp on npm](https://www.npmjs.com/package/scrcpy-mcp)
- [minhalvp/android-mcp-server](https://mcpservers.org/servers/minhalvp/android-mcp-server)
- [Android MCP — mcpmarket listing](https://mcpmarket.com/server/android-5)
- [Cursor forum — request for registerMcpServerDefinitionProvider support](https://forum.cursor.com/t/support-vs-codes-register-mcp-server-definition-provider-api/133031)
- [Adding an MCP Server to a VS Code Extension — Ken Muse](https://www.kenmuse.com/blog/adding-mcp-server-to-vs-code-extension/)
