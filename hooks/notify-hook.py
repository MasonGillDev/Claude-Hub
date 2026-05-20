#!/usr/bin/env python3
"""Claude Code hook -> Claude Hub.

Reads a hook event JSON on stdin, forwards it to the Claude Hub dashboard
(so the relevant project/session pulses), and shows a native macOS
notification for the events that mean "your turn" / "needs you".

The banner is clickable: clicking it POSTs to the dashboard's /resume endpoint,
which focuses the session's Terminal tab (or reopens `claude --resume`) — the
same action as the Focus/Resume button. This needs the vendored
terminal-notifier (osascript banners can't carry a click action); if it's
missing we fall back to a plain, non-clickable banner.

Wired in ~/.claude/settings.json for: Stop, Notification, SubagentStop,
UserPromptSubmit. Always exits 0 so it never interrupts Claude.
"""
import json
import os
import subprocess
import sys
import urllib.request

PORT = os.environ.get("CLAUDE_HUB_PORT", "3000")
URL = f"http://127.0.0.1:{PORT}/api/events"

raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    data = {}

# 1) Forward to the dashboard (best-effort; never block Claude).
try:
    req = urllib.request.Request(
        URL,
        data=raw.encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=1).read()
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


ev = data.get("hook_event_name", "")
if ev in TITLES:
    cwd = (data.get("cwd") or "").rstrip("/")
    proj = os.path.basename(cwd) if cwd else "Claude"
    msg = (data.get("message") or "").replace("\n", " ").strip()
    body = msg or DEFAULT_BODY[ev]
    title = f"{proj}: {TITLES[ev]}"
    session_id = data.get("session_id") or ""
    # Only the "needs you" event makes a sound, to keep per-turn Stop quiet.
    wants_sound = ev == "Notification"

    posted = False
    # Preferred path: clicking the banner POSTs to /resume, which brings the
    # session's Terminal tab to the front (or reopens `claude --resume`) —
    # exactly like the Focus/Resume button in the dashboard.
    if session_id and os.path.exists(TERMINAL_NOTIFIER):
        resume_url = f"http://127.0.0.1:{PORT}/api/sessions/{session_id}/resume"
        args = [
            TERMINAL_NOTIFIER,
            "-title", title,
            "-message", body,
            "-execute", f"curl -s -X POST {resume_url} >/dev/null 2>&1",
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

sys.exit(0)
