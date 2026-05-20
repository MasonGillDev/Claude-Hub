# Claude Hub — TODO

Working list of what's next, ordered roughly by impact. Notes in parentheses
point at the relevant code.

## Big bet: make the UI a real interaction surface

The strategic direction. Today sessions are **terminal-born** and the dashboard
only *observes* them (reads JSONL) + gates tool calls. If the dashboard can
*own* sessions, the terminal layer (and its whole Mac-only / cross-platform
problem) becomes optional. Verified that this is lossless: a non-interactively
created session writes the same resumable `~/.claude/projects/<enc>/<id>.jsonl`
and `claude --resume <id>` reopens it from a terminal — so "UI owns it" never
traps the user in the UI.

- [ ] **Spawn sessions from the UI via the Agent SDK / `claude -p` (streaming).**
      The dashboard becomes the client (owns stdin/stdout). No terminal to focus.
- [ ] **Send-prompt input channel** — a box to push a new prompt into a running
      session (the SDK gives this; the observe-only model can't without poking the pty).
- [ ] **Live transcript streaming** — currently we read JSONL after the fact;
      need streaming output (`--output-format=stream-json`, `--include-partial-messages`).
- [ ] **Handle non-tool prompts** — Claude's free-text questions, plan approvals
      (`ExitPlanMode`), interrupts/steering. Tool approval is only one bit.
- [ ] Keep terminal-born sessions working alongside UI-owned ones (hybrid).

## Tool-call approvals — polish & rethink

The approval tray is the best *first* surface to prove UI-driven UX. But its
semantics currently assume a terminal is watching.

- [ ] **Rework the 20s timeout + terminal fallback** (`~/.claude-hub/approve-hook.py`,
      `lib/approvals.ts`). For a UI-first user, "give up and fall back to the
      terminal prompt" is backwards — want indefinite wait + push notification,
      or a per-session policy.
- [ ] Richer approval detail in the tray (full command/diff, not just first 180 chars).
- [ ] Remember decisions / allow-rules per session (don't re-ask for the same thing).

## Cross-platform

See [docs/PORTING.md](docs/PORTING.md) for the full analysis + best-effort plan.

- [ ] **`lib/resume.ts` is macOS-only and hard-fails elsewhere** (no platform guards;
      `osascript` at :19/:115, `ps` at :56). `openTerminal`/`resumeInTerminal`/
      `startSessionInTerminal` lack try/catch → `/api/sessions/[id]/resume` will
      **500 on Win/Linux** instead of degrading. Add a platform dispatch + graceful fallback.
- [ ] Linux terminal launcher (gnome-terminal/konsole/xterm detection) + `notify-send` banner.
- [ ] Windows: `wt.exe` launcher; fix hook `command` wiring (can't exec `.py` directly).
- [ ] `install-node.sh` is Apple-Silicon only (hardcoded `darwin-arm64`) — detect `uname -m`/OS.

## Smaller / polish

- [ ] Optional: have `setup.sh` auto-download `terminal-notifier` so clickable
      banners work out of the box (currently degrades to non-clickable `osascript`).
- [ ] Make the dashboard port configurable end-to-end (hooks already honor
      `CLAUDE_HUB_PORT`; the app side assumes 3000).
- [ ] Empty-state / first-run UX when `~/.claude/projects` has no data yet.
- [ ] Manual check still open: spawn via SDK, then `claude --resume <id>` in a
      real **interactive** terminal and confirm live state matches (round-trip was
      only proven with `-p --resume`, non-interactive both ways).
