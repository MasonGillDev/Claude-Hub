# Multi-device federation

The hub (this Mac) shows sessions from other machines by polling a small
**device agent** running on each of them. The agent is read-only: it serves
that machine's `~/.claude` data over HTTP, gated by a bearer token. The hub
keeps a last-good snapshot per device, so powered-off devices still show
their sessions (dimmed, "offline · last seen …").

```
┌─ hub (this Mac) ───────────────┐         ┌─ other Mac / Windows ────────┐
│ Next.js dashboard              │  HTTP   │ agent/index.ts  (port 3777)  │
│  lib/devices.ts   ← devices.json ──────▶ │  Bearer-token auth           │
│  lib/agentClient.ts + snapshot │         │  core/ reads ~/.claude       │
│  cache (~/.claude-hub/device-cache)      │  config: ~/.claude-hub/agent.json
└────────────────────────────────┘         └──────────────────────────────┘
```

The shared read logic lives in `core/` (no dependencies, platform-neutral) and
is used in-process by the hub for the local device and by the agent on remotes.

## Installing the agent on another device

Requirements: Node 20+ and the repo. The agent's only npm dependency is `tsx`.

### macOS

```sh
git clone <this repo> claude-hub && cd claude-hub/agent
npm install
npm start
```

### Windows

1. Install Node from https://nodejs.org (LTS).
2. Clone the repo (Git for Windows, or download a zip).
3. In PowerShell:

```powershell
cd claude-hub\agent
npm install
npm start
```

You may get a Windows Defender Firewall prompt the first time — allow access
on **private networks** so the hub can reach it over the LAN.

### First run

On first start the agent writes `~/.claude-hub/agent.json` with a **generated
token** and prints it, along with a ready-to-paste registration snippet:

```json
{ "name": "<hostname>", "token": "<generated>", "port": 3777, "bind": "0.0.0.0" }
```

Edit `name` to taste (it's the label the hub displays). The agent must be
restarted after config changes.

## Registering devices on the hub

Create/edit `~/.claude-hub/devices.json` **on the hub Mac**:

```json
{
  "devices": [
    {
      "id": "windows-pc",
      "name": "Windows PC",
      "url": "http://192.168.1.50:3777",
      "token": "<token from that device's agent.json>"
    }
  ]
}
```

- `id` — stable slug, used in hub URLs and cache filenames.
- `url` — the device's LAN address + agent port. Give devices static DHCP
  leases (or use their `.local` mDNS names) so this doesn't drift.
- No hub restart needed — the file is read per request.

## Agent API (consumed by the hub)

All `GET`, all require `Authorization: Bearer <token>`:

| Endpoint | Returns |
|---|---|
| `/v1/info` | device name, platform, agent version |
| `/v1/projects` | projects on that device |
| `/v1/projects/:id/sessions` | session summaries |
| `/v1/sessions/:id` | session detail (recap, last interaction) |
| `/v1/sessions/:id/transcript` | raw transcript JSONL (for future porting) |

Hub-side REST (other local apps can consume these):
`/api/devices`, `/api/devices/:id/projects`,
`/api/devices/:id/projects/:projectId/sessions`, `/api/devices/:id/sessions/:sessionId`.

## Phase 2: cross-device notifications + approvals

The notify/approve hooks (vendored in `hooks/`) are hub-aware: they read
`~/.claude-hub/hub.json` (`{"url": ..., "deviceId": ...}`) and fall back to
`http://127.0.0.1:3000` when it's absent — so the hub machine's behavior is
unchanged. On remote devices, events/approvals POST to the hub tagged with
`deviceId`, which makes the bell, card pulses, and approvals tray work for
sessions on any machine (links route to `/devices/<id>/...`). Native banners:
terminal-notifier/osascript on macOS, a PowerShell balloon on Windows.

Install on each device (after `git pull`; needs Python 3, which macOS has and
Windows users likely installed alongside Claude Code):

```sh
# hub Mac (no args — local behavior, just refreshes the installed scripts):
python3 hooks/install.py

# other Mac:
python3 hooks/install.py --hub-url http://192.168.1.141:3000 --device-id <id-from-devices.json>

# Windows (PowerShell):
python hooks\install.py --hub-url http://192.168.1.141:3000 --device-id masonpc
```

The installer copies the hooks into `~/.claude-hub/`, writes `hub.json`, and
(re)wires `~/.claude/settings.json` idempotently (backup written next to it).
Restart Claude Code on that device afterwards.

**Approval mode for remote sessions** is toggled from the hub's remote session
page; the hub calls the device agent's `POST /v1/approval-mode`, which writes
that machine's `~/.claude-hub/approval-mode.json` (read by its approve-hook).
Requires agent ≥ 0.2.0 — `git pull` + restart the agent on each device.

## Security model

Plain HTTP on the home LAN with a per-device bearer token (generated,
compared timing-safe). Transcripts cross the LAN unencrypted — acceptable on
a trusted home network; add Tailscale or TLS before exposing beyond it.
Tokens live only in `~/.claude-hub/` on each machine and never reach the
browser (all agent calls are server-side).

## Roadmap

- **Phase 3** — session **porting**: copy a transcript from another device,
  rewrite `cwd`, resume locally (`/v1/sessions/:id/transcript` already exists).
- **Phase 4** — remote drive: interact with sessions running on other devices
  via SDK-hosted sessions on the agent.
