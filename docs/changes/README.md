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
| 02 | Design token layer / theme awareness | [02-design-tokens.md](02-design-tokens.md) | [`.claude/plans/02-design-tokens.md`](../../.claude/plans/02-design-tokens.md) | Done |
| 03 | Pan re-render performance | [03-pan-rerender-perf.md](03-pan-rerender-perf.md) | [`.claude/plans/03-pan-rerender-perf.md`](../../.claude/plans/03-pan-rerender-perf.md) | Done |
| 04 | Token cleanup / interaction pass | [04-token-cleanup-interaction.md](04-token-cleanup-interaction.md) | [`.claude/plans/04-token-cleanup-interaction.md`](../../.claude/plans/04-token-cleanup-interaction.md) | Done |
| 05 | Toolbar & status rework | [05-toolbar-status-rework.md](05-toolbar-status-rework.md) | [`.claude/plans/05-toolbar-status-rework.md`](../../.claude/plans/05-toolbar-status-rework.md) | Done |
| 06 | State surfaces | [06-state-surfaces.md](06-state-surfaces.md) | [`.claude/plans/06-state-surfaces.md`](../../.claude/plans/06-state-surfaces.md) | Done |
| 07 | Feedback & discoverability | [07-feedback-discoverability.md](07-feedback-discoverability.md) | [`.claude/plans/07-feedback-discoverability.md`](../../.claude/plans/07-feedback-discoverability.md) | Planned |

Changes 04–07 are the UI overhaul that 02 deliberately deferred. 04 finishes the
token migration and is zero-risk; 05 is where the panel starts to look designed;
06 makes the pre-stream states honest; 07 is additive polish. Do them in order —
05 consumes 04's elevation and focus tokens, and 06 reuses the `device-info`
handling that 05 introduces.

04, 05 and 06 all landed on `feature/token-cleanup-interaction`. Their Outcome
sections ([04](04-token-cleanup-interaction.md#outcome),
[05](05-toolbar-status-rework.md#outcome),
[06](06-state-surfaces.md#outcome)) record what shipped beyond the written
plans and which of their checks still need a human eye in a running Extension
Development Host.

07 can now build on 06: the pre-stream surfaces live in
`webview-ui/src/components/states/`, `.state-action` is the shared quiet button
for anything added to them, and `connect-progress` / `diagnostic-result` are
precedents for any further extension → webview status message.

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
