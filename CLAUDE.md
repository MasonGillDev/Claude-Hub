# Claude Hub

Local Next.js (App Router, TS, Tailwind) dashboard for managing **Claude Code sessions** across projects: browse projects → sessions, rename, see last interaction, resume/focus the session's terminal, get notified when a session needs attention, and flag sessions Open/Finished. The REST API under `app/api/*` is a first-class surface — other local apps consume it, so keep it stable.

## Multi-device (hub + agents)

This Mac is the **hub**; other devices (second Mac, Windows) run the read-only **device agent** (`agent/index.ts`, port 3777, bearer-token auth) which serves their `~/.claude` over the LAN. Shared read logic lives in `core/` (dependency-free, platform-neutral — used in-process by the hub for the local device and by agents on remotes; `lib/claude.ts` = core + hub-only sidecar overlays). The hub polls agents per request and keeps last-good snapshots in `~/.claude-hub/device-cache/` so offline devices still render (dimmed). Config: hub-side registry `~/.claude-hub/devices.json`; agent-side `~/.claude-hub/agent.json` (token generated on first run). Remote UI is read-only at `/devices/[deviceId]/...`; remote REST under `/api/devices/*`. Full details + install steps: `docs/DEVICES.md`.

## ⚠️ Parts of this system live OUTSIDE this repo

Several behaviors are NOT implemented in this codebase. Grepping the repo will not find them — they live in the user's home dir:

| Concern | Where it actually lives | In this repo? |
|---|---|---|
| **Native macOS notification banner** | `~/.claude-hub/notify-hook.py` (fires `osascript display notification`) | ❌ NO |
| **Tool-call approval gating** | `~/.claude-hub/approve-hook.py` (PreToolUse: posts to `/api/approvals`, polls ~20s, returns allow/deny/ask) | ❌ NO |
| Hook wiring | `~/.claude/settings.json` → `hooks`: `PreToolUse` (Bash\|Edit\|Write…) runs `approve-hook.py`; Stop/Notification/SubagentStop/UserPromptSubmit run `notify-hook.py` | ❌ NO |
| In-app bell / card pulse | `components/AttentionBell.tsx` + `app/api/events/*` | ✅ yes |
| Persisted custom names / status / attention | `~/.claude-hub/{names,status,attention}.json` (sidecars) | data only |
| Node runtime | `~/.local/node` (no system Node / Homebrew) | n/a |

**If asked "where's the notification banner?":** it is `~/.claude-hub/notify-hook.py`, not this repo. The repo only owns the in-app bell/pulse. (`lib/resume.ts` does use `osascript`, but for *Terminal focus*, not notifications.)

## Notifications — full flow

1. Claude Code fires a hook event (`Stop` = your turn / `Notification` = needs input / `SubagentStop` / `UserPromptSubmit`).
2. `~/.claude/settings.json` runs `~/.claude-hub/notify-hook.py` with the event JSON on stdin.
3. `notify-hook.py` does **two** things:
   - **POST** the event to `http://127.0.0.1:3000/api/events` → drives the **in-app bell/pulse** (stored in `~/.claude-hub/attention.json`).
   - For Stop/Notification/SubagentStop, fire the **native macOS banner** via `osascript`. (`UserPromptSubmit` only clears attention — no banner.)
4. `AttentionBell.tsx` polls `GET /api/events` every 1.5s and lights up cards/rows; opening or resuming a session clears its attention.

So: **in-app bell = this repo; native banner = the external hook script.** They're independent paths fed by the same script.

## Tool-call approvals (opt-in)

Per-session toggle (`~/.claude-hub/approval-mode.json`) to approve tool calls from the UI instead of the terminal. **Default off → the PreToolUse hook emits nothing → normal/auto behavior, unchanged.** When ON for a session:
1. `approve-hook.py` (PreToolUse, matches `Bash|Edit|Write|MultiEdit|NotebookEdit`) `POST`s a pending approval to `/api/approvals`, fires a banner, and **blocks while polling** for ~20s.
2. Dashboard `ApprovalsTray` lists it with Allow/Deny; the decision is written back; the hook returns `allow`/`deny`.
3. No click in 20s, or dashboard unreachable → hook returns `ask` → falls back to Claude's normal **terminal** prompt. (Letting Claude's *own* hook timeout fire instead would auto-proceed — so the hook always returns its own decision within the window.)

Pending approvals drive an indigo "awaiting approval" pulse (top priority over attention/running). Store + prune in `lib/approvals.ts`; endpoints `app/api/approvals/*`.

## Data sources

- **Reads** `~/.claude/`: `projects/<enc>/<id>.jsonl` (transcripts), `jobs/*/state.json` (native `/rename` names), `sessions/*.json` (live pid + busy/idle status). Note: encoded project dir names are lossy (spaces → `-`), so real cwd comes from inside the JSONL, not the dir name.
- **Writes** `~/.claude-hub/` sidecars (never touches Claude's own files): `names.json` (UI renames), `status.json` (open/finished), `attention.json` (pending notifications).

## Key code

- `core/` — device-portable read layer for `~/.claude` (projects/sessions/transcript parsing, job names, CLI running set). No deps, runs on the hub AND inside agents on other devices. Don't import hub sidecars here.
- `lib/claude.ts` — LOCAL device view: `core/` + hub-only overlays (sidecar custom names, attention, status, approvals, SDK-daemon running). Display name precedence: sidecar > job name > ai-title > first prompt > id. Running (busy) suppresses attention — a session can't be both.
- `agent/` — device agent for remotes (own `package.json`, only dep `tsx`; `npm run agent` to run locally).
- `lib/devices.ts`, `lib/agentClient.ts` — device registry + agent HTTP client with snapshot cache.
- `lib/attention.ts`, `lib/status.ts` — sidecar stores.
- `lib/resume.ts` — Terminal.app focus (pid → tty → tab, AXRaise for cross-Space) and `claude --resume` fallback. NOT notifications.
- `app/api/*` — REST API (projects, sessions, events, resume, devices).
- `components/` — `AttentionBell` (in-app notifications), `ResumeButton` (focus/resume), `RenameField`, `StatusControl`, `DeleteControl`, `New{Session,Project}Button`, `RemoteDeviceSections` (home-page device grids), `SessionBits` (shared session-detail pieces).

## Dev

`npm run dev` (needs `~/.local/node/bin` on PATH; e.g. a terminal where `~/.zshrc` is sourced). Binds to `127.0.0.1:3000`.
