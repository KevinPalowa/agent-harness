# pi extensions (local)

| Extension | What it does | Controls |
|---|---|---|
| `opencode-ui.ts` | OpenCode-style header, left-border prompt, and status row with live Build/Plan/Execute mode | `/opencode-ui`, `--no-opencode-ui` |
| `plan-mode/` | Read-only planning mode, todo tracking, execution handoff | `/plan`, `Shift+Tab`, `--plan`, `/todos` |
| `git-checkpoint.ts` | Stash per turn; `/fork` offers code restore | automatic |
| `ui.ts` | Custom footer (model, thinking, context bar, tokens, cost, branch) + title spinner | `/ui`, `--no-ui` |
| `compact-tools.ts` | One-line edit/write/read rows, summary + optional diff | `/toolview` |
| `format.ts` | Runs local biome/prettier after edit/write | `/format` |
| `permission-gate.ts` | Confirms rm -rf, sudo, force push, curl\|sh, … | automatic |
| `protected-paths.ts` | Blocks .env/.git/node_modules/keys/auth.json; confirms lockfiles | automatic |

Notes
- The OpenCode look uses [`themes/opencode.json`](../themes/opencode.json) and its light variant. `/settings` → Theme switches them.
- `Shift+Tab` needs `~/.pi/agent/keybindings.json` to move `app.thinking.cycle` (currently `ctrl+shift+t`).
- `/toolview` and `/format` affect new work only (existing transcript rows keep their renderer).
- Extensions reload with `/reload`.
