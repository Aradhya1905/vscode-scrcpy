# Plans

Short, step-by-step execution plans. Each one points at a detail document in
[`docs/changes/`](../../docs/changes/) that explains *why* the change is being
made and how to verify it.

| Plan | Change doc |
|------|-----------|
| [01-webview-fonts.md](01-webview-fonts.md) | [`docs/changes/01-webview-fonts.md`](../../docs/changes/01-webview-fonts.md) |
| [02-design-tokens.md](02-design-tokens.md) | [`docs/changes/02-design-tokens.md`](../../docs/changes/02-design-tokens.md) |
| [03-pan-rerender-perf.md](03-pan-rerender-perf.md) | [`docs/changes/03-pan-rerender-perf.md`](../../docs/changes/03-pan-rerender-perf.md) |
| [04-token-cleanup-interaction.md](04-token-cleanup-interaction.md) | [`docs/changes/04-token-cleanup-interaction.md`](../../docs/changes/04-token-cleanup-interaction.md) |
| [05-toolbar-status-rework.md](05-toolbar-status-rework.md) | [`docs/changes/05-toolbar-status-rework.md`](../../docs/changes/05-toolbar-status-rework.md) |
| [06-state-surfaces.md](06-state-surfaces.md) | [`docs/changes/06-state-surfaces.md`](../../docs/changes/06-state-surfaces.md) |
| [07-feedback-discoverability.md](07-feedback-discoverability.md) | [`docs/changes/07-feedback-discoverability.md`](../../docs/changes/07-feedback-discoverability.md) |

Plans 01 and 02 are coupled: the font tokens live in the token layer that plan
02 introduces, so 01 lands the `tokens.css` file and 02 fills it out. Do them in
order. Plan 03 is independent and touches only `MirrorApp.tsx`.

Plans 04–07 are the UI overhaul. 04 → 05 → 06 is a dependency chain (05 uses
04's tokens, 06 uses 05's `device-info` handling). 07's three pieces — toasts,
perf HUD, keybindings — are independent of each other and can land in any order
after 05.

Unscheduled work is parked in
[`docs/changes/backlog.md`](../../docs/changes/backlog.md).
