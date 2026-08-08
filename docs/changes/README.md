# Planned Changes

Working index for the UI/performance overhaul that came out of the August 2026 audit.
Each entry below has a detail document in this folder describing the problem, the fix,
the files touched, and how to verify it.

Execution plans (short, step-by-step) live in [`.claude/plans/`](../../.claude/plans/)
and point back to these documents.

## Status

| # | Change | Detail doc | Plan | Status |
|---|--------|-----------|------|--------|
| 01 | Webview fonts (CSP-blocked import) | [01-webview-fonts.md](01-webview-fonts.md) | [`.claude/plans/01-webview-fonts.md`](../../.claude/plans/01-webview-fonts.md) | Done |
| 02 | Design token layer / theme awareness | [02-design-tokens.md](02-design-tokens.md) | [`.claude/plans/02-design-tokens.md`](../../.claude/plans/02-design-tokens.md) | Reverted |
| 03 | Pan re-render performance | [03-pan-rerender-perf.md](03-pan-rerender-perf.md) | [`.claude/plans/03-pan-rerender-perf.md`](../../.claude/plans/03-pan-rerender-perf.md) | Done |
| 04 | Token cleanup / interaction pass | [04-token-cleanup-interaction.md](04-token-cleanup-interaction.md) | [`.claude/plans/04-token-cleanup-interaction.md`](../../.claude/plans/04-token-cleanup-interaction.md) | Reverted |
| 05 | Toolbar & status rework | [05-toolbar-status-rework.md](05-toolbar-status-rework.md) | [`.claude/plans/05-toolbar-status-rework.md`](../../.claude/plans/05-toolbar-status-rework.md) | Reverted |
| 06 | State surfaces | [06-state-surfaces.md](06-state-surfaces.md) | [`.claude/plans/06-state-surfaces.md`](../../.claude/plans/06-state-surfaces.md) | Reverted |
| 07 | Feedback & discoverability | [07-feedback-discoverability.md](07-feedback-discoverability.md) | [`.claude/plans/07-feedback-discoverability.md`](../../.claude/plans/07-feedback-discoverability.md) | Dropped |

## Reverted — read this before picking any of it back up

02, 04, 05 and 06 shipped on `feature/token-cleanup-interaction` and were then
reverted: the redesigned look was not wanted. `webview-ui/src/` is back to its
state at `cadca79`. 07 was never started and is dropped with them.

What the revert removed: `styles/tokens.css` and every stylesheet rewired to it,
`components/StatusChip.tsx`, `components/states/`, `hooks/useDismissable.ts`,
the toolbar/`DeviceSelector`/`Placeholder` rewrites, the `onVideoSizeChange`
callback on `useVideoDecoder`, and the `toolbarPosition` setting (back to the
`toolbarAtBottom` boolean — anyone who ran a redesign build gets the default
bottom placement again).

What the revert kept, deliberately: the extension-side work in
`src/services/AdbShellService.ts`, `src/services/ScrcpyService.ts` and
`src/views/ScrcpySidebarView.ts`. That is real functionality (connect progress,
diagnostics), not styling. It still emits `connect-progress` and
`diagnostic-result`; nothing in the webview consumes them right now, which is
harmless — unknown message types are ignored.

The detail docs below are left in place as a record of what was tried. Treat
them as history, not as a plan.

The original sequencing rationale, for reference: 04 finished the token
migration, 05 was where the panel started to look designed, 06 made the
pre-stream states honest, 07 was additive polish. 05 consumed 04's elevation and
focus tokens, and 06 reused the `device-info` handling 05 introduced — so any
revival has to start at 04.

## Not yet scheduled

Remaining findings from the same audit are parked in
[backlog.md](backlog.md) so they don't get lost. Nothing there is being
worked on right now.

Longer-horizon research (MCP server / CLI for LLM-driven device control) is in
[`docs/feature-research/`](../feature-research/).

## Ground rules for these changes

- No behaviour change to mirroring, input, or the ADB layer. UI and render path only.
- Every change must keep `npm run typecheck && npm run lint && npm run format:check` green.
- Visual changes must work in both a dark and a light VS Code theme.
- No change may add a network request from the webview — the CSP forbids it.
