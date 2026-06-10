#!/usr/bin/env python3
"""Claude Code hook -> Claude Hub.

Reads a hook event JSON on stdin, forwards it to the Claude Hub dashboard
(so the relevant project/session pulses), and shows a native notification
for the events that mean "your turn" / "needs you".

Hub location comes from ~/.claude-hub/hub.json ({"url": ..., "deviceId": ...},
written by hooks/install.py). Without it, this defaults to the local dashboard
at http://127.0.0.1:3000 — the original single-machine behavior, unchanged.
On remote devices, deviceId tags forwarded events so the hub's bell links to
/devices/<deviceId>/sessions/<sessionId>.

Banners:
  - macOS: clickable via the vendored terminal-notifier (click = focus/resume
    locally on the hub machine, or open the hub's session page from a remote
    device); falls back to a plain osascript banner.
  - Windows: balloon notification via PowerShell (non-clickable, detached so
    it never blocks Claude).

Wired in ~/.claude/settings.json for: Stop, Notification, SubagentStop,
UserPromptSubmit. Always exits 0 so it never interrupts Claude.
"""
import json
import os
import subprocess
import sys
import urllib.request

PORT = os.environ.get("CLAUDE_HUB_PORT", "3000")
HUB_CONFIG = os.path.expanduser("~/.claude-hub/hub.json")


def load_hub():
    """(base_url, device_id) — hub.json if present, else the local default."""
    try:
        with open(HUB_CONFIG) as f:
            cfg = json.load(f)
        url = (cfg.get("url") or "").rstrip("/")
        if url:
            return url, (cfg.get("deviceId") or None)
    except Exception:
        pass
    return f"http://127.0.0.1:{PORT}", None


BASE, DEVICE_ID = load_hub()

raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    data = {}

# 1) Forward to the dashboard (best-effort; never block Claude).
payload = dict(data) if data else None
if payload is not None and DEVICE_ID:
    payload["device_id"] = DEVICE_ID
body = json.dumps(payload).encode("utf-8") if payload is not None else raw.encode("utf-8")
try:
    req = urllib.request.Request(
        f"{BASE}/api/events",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=2).read()
except Exception:
    pass

# 2) Native notification for attention-worthy events.
TITLES = {
    "Stop": "Finished — your turn",
    "Notification": "Needs your input",
    "SubagentStop": "Subagent finished",
}
DEFAULT_BODY = {
    "Stop": "Claude finished responding.",
    "Notification": "Claude is waiting on you.",
    "SubagentStop": "A background subagent finished.",
}

# Vendored terminal-notifier (Intel binary; runs under Rosetta). Unlike
# osascript's `display notification`, it can attach a click action via -execute.
TERMINAL_NOTIFIER = os.path.expanduser(
    "~/.claude-hub/terminal-notifier.app/Contents/MacOS/terminal-notifier"
)


def _osascript_banner(title: str, body: str, sound: bool) -> None:
    """Fallback: plain, non-clickable banner if terminal-notifier is missing."""
    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')

    snd = ' sound name "Glass"' if sound else ""
    script = f'display notification "{esc(body)}" with title "{esc(title)}"{snd}'
    try:
        subprocess.run(
            ["osascript", "-e", script],
            timeout=5,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def _windows_balloon(title: str, body: str) -> None:
    """Tray balloon via PowerShell — detached (Popen) so the ~8s the icon
    stays alive never blocks the hook."""
    def esc(s: str) -> str:
        return s.replace("'", "''")

    script = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "Add-Type -AssemblyName System.Drawing;"
        "$n = New-Object System.Windows.Forms.NotifyIcon;"
        "$n.Icon = [System.Drawing.SystemIcons]::Information;"
        "$n.Visible = $true;"
        f"$n.BalloonTipTitle = '{esc(title)}';"
        f"$n.BalloonTipText = '{esc(body)}';"
        "$n.ShowBalloonTip(7000);"
        "Start-Sleep -Seconds 8;"
        "$n.Dispose()"
    )
    try:
        subprocess.Popen(
            ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
    except Exception:
        pass


def _macos_banner(title: str, body: str, session_id: str, wants_sound: bool) -> None:
    posted = False
    # Preferred path: clickable banner. Locally the click focuses/resumes the
    # session's terminal (via the hub's /resume); from a remote device the
    # session's terminal is on THIS machine already, so the click opens the
    # hub's read-only page for it instead.
    if session_id and os.path.exists(TERMINAL_NOTIFIER):
        if DEVICE_ID:
            action = f"open {BASE}/devices/{DEVICE_ID}/sessions/{session_id}"
        else:
            resume_url = f"{BASE}/api/sessions/{session_id}/resume"
            action = f"curl -s -X POST {resume_url} >/dev/null 2>&1"
        args = [
            TERMINAL_NOTIFIER,
            "-title", title,
            "-message", body,
            "-execute", action,
            # Collapse repeats for the same session into one banner.
            "-group", f"claude-hub-{session_id}",
        ]
        if wants_sound:
            args += ["-sound", "Glass"]
        try:
            subprocess.run(
                args,
                timeout=5,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            posted = True
        except Exception:
            posted = False

    if not posted:
        _osascript_banner(title, body, wants_sound)


ev = data.get("hook_event_name", "")
if ev in TITLES:
    cwd = (data.get("cwd") or "").rstrip("/\\")
    proj = os.path.basename(cwd) if cwd else "Claude"
    msg = (data.get("message") or "").replace("\n", " ").strip()
    body_text = msg or DEFAULT_BODY[ev]
    title = f"{proj}: {TITLES[ev]}"
    session_id = data.get("session_id") or ""
    # Only the "needs you" event makes a sound, to keep per-turn Stop quiet.
    wants_sound = ev == "Notification"

    if sys.platform == "darwin":
        _macos_banner(title, body_text, session_id, wants_sound)
    elif sys.platform == "win32":
        _windows_balloon(title, body_text)

sys.exit(0)
