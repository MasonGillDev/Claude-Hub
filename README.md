# Claude Hub

A local **Next.js dashboard for managing [Claude Code](https://docs.claude.com/en/docs/claude-code) sessions** across all your projects. Browse projects → sessions, rename them, see the last interaction, resume or focus a session's terminal, get notified when a session needs your attention, and flag sessions as Open or Finished.

It reads (read-only) from `~/.claude/` and writes its own state to `~/.claude-hub/` sidecar files — it never modifies Claude Code's own data.

> The REST API under `app/api/*` is a first-class surface: other local apps consume it, so it's kept stable.

## Features

- **Projects → sessions browser** — every project Claude Code has touched, with its sessions and last activity.
- **Rename** sessions/projects with friendly names (stored in a sidecar, never overwriting Claude's data).
- **Resume / focus** — jump straight to a session's Terminal.app tab (via `osascript`, with `claude --resume` as a fallback).
- **Attention notifications** — an in-app bell + card pulse light up when a session needs input or finishes its turn.
- **Open / Finished status** — flag where each session stands.
- **Tool-call approvals (opt-in)** — approve `Bash`/`Edit`/`Write`/… calls from the UI instead of the terminal, per session.

## Architecture at a glance

| Concern | Lives in |
|---|---|
| Dashboard UI + REST API | **this repo** (`app/`, `components/`, `lib/`) |
| In-app bell / card pulse | **this repo** (`components/AttentionBell.tsx` + `app/api/events/*`) |
| Native macOS notification banner | `~/.claude-hub/notify-hook.py` *(external hook, not in this repo)* |
| Tool-call approval gating | `~/.claude-hub/approve-hook.py` *(PreToolUse hook, not in this repo)* |
| Hook wiring | `~/.claude/settings.json` *(not in this repo)* |

**Data sources**

- **Reads** `~/.claude/`: `projects/<enc>/<id>.jsonl` (transcripts), `jobs/*/state.json` (native `/rename` names), `sessions/*.json` (live pid + busy/idle). The encoded project dir name is lossy (spaces → `-`), so the real cwd comes from inside the JSONL.
- **Writes** `~/.claude-hub/` sidecars only: `names.json`, `status.json`, `attention.json`, plus approval state.

### Key modules

- `lib/claude.ts` — reads `~/.claude`, builds projects/sessions, resolves display name (sidecar > job name > ai-title > first prompt > id), running/attention/status.
- `lib/attention.ts`, `lib/status.ts` — sidecar stores.
- `lib/approvals.ts` — pending tool-call approvals store + pruning.
- `lib/resume.ts` — Terminal.app focus (pid → tty → tab, AXRaise for cross-Space) and `claude --resume` fallback.
- `components/` — `AttentionBell`, `ResumeButton`, `RenameField`, `StatusControl`, `DeleteControl`, `ApprovalsTray`, `New{Session,Project}Button`.

## REST API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create a project |
| `GET` `DELETE` | `/api/projects/[projectId]` | Get / delete a project |
| `GET` `POST` | `/api/projects/[projectId]/sessions` | List / create sessions |
| `GET` `PATCH` `DELETE` | `/api/sessions/[sessionId]` | Get / rename+status / delete a session |
| `POST` | `/api/sessions/[sessionId]/resume` | Focus or resume the session |
| `GET` `POST` `DELETE` | `/api/events` | Attention feed (poll / push / clear all) |
| `DELETE` | `/api/events/[sessionId]` | Clear one session's attention |
| `POST` | `/api/approvals` | Submit a pending tool-call approval |
| `GET` `POST` `DELETE` | `/api/approvals/[id]` | Poll / decide / cancel an approval |

## Development

This setup uses a self-contained Node install at `~/.local/node` (no system Node / Homebrew required). Run `./install-node.sh` if you don't have it.

```bash
# Ensure ~/.local/node/bin is on your PATH (a terminal that sources ~/.zshrc has it)
npm install
npm run dev      # binds to http://127.0.0.1:3000
```

| Script | Does |
|---|---|
| `npm run dev` | Start the dev server on `127.0.0.1:3000` |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Lint |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 3.
