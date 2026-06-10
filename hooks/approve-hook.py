#!/usr/bin/env python3
"""Claude Code PreToolUse hook -> Claude Hub tool-call approvals.

Behavior:
  - Approval mode OFF for this session (default): emit NOTHING and exit 0, so
    the tool call proceeds through Claude's normal/auto permission flow,
    completely unchanged. (This is what keeps non-opted-in sessions unaffected.)
  - Approval mode ON: register a pending approval with the dashboard, fire a
    banner, then poll for up to ~20s. Allow/Deny -> return that decision.
    No click in time, or the dashboard is unreachable -> return "ask", which
    falls back to Claude's normal terminal permission prompt.

The dashboard may be on another machine: ~/.claude-hub/hub.json
({"url": ..., "deviceId": ...}, written by hooks/install.py) points at it and
tags requests with this device's registry id. Without it, defaults to the
local dashboard at http://127.0.0.1:3000 — the original behavior. Approval
mode itself is always read from THIS machine's ~/.claude-hub/approval-mode.json
(toggled from the hub via the agent's /v1/approval-mode).

Any unexpected error while mode is ON returns "ask" (never silently proceed).
Wired in ~/.claude/settings.json as PreToolUse for Bash|Edit|Write|MultiEdit,
with a hook `timeout` (30s) safely above this script's own ~20s poll window.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import uuid

PORT = os.environ.get("CLAUDE_HUB_PORT", "3000")
HUB_CONFIG = os.path.expanduser("~/.claude-hub/hub.json")
MODE_FILE = os.path.expanduser("~/.claude-hub/approval-mode.json")
GATED = {"Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"}
POLL_WINDOW_S = 20.0
POLL_EVERY_S = 0.5
TERMINAL_NOTIFIER = os.path.expanduser(
    "~/.claude-hub/terminal-notifier.app/Contents/MacOS/terminal-notifier"
)


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


def emit(decision: str, reason: str = "") -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }))


def mode_on(session_id: str) -> bool:
    try:
        with open(MODE_FILE) as f:
            return json.load(f).get(session_id) is True
    except Exception:
        return False


def post_json(path: str, payload: dict, timeout: float = 2.0) -> bool:
    try:
        req = urllib.request.Request(
            BASE + path,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=timeout).read()
        return True
    except Exception:
        return False


def get_decision(req_id: str) -> str:
    try:
        with urllib.request.urlopen(f"{BASE}/api/approvals/{req_id}", timeout=2.0) as r:
            return json.load(r).get("decision", "pending")
    except Exception:
        return "error"


def delete(req_id: str) -> None:
    try:
        req = urllib.request.Request(f"{BASE}/api/approvals/{req_id}", method="DELETE")
        urllib.request.urlopen(req, timeout=2.0).read()
    except Exception:
        pass


def session_page_url(session_id: str) -> str:
    if DEVICE_ID:
        return f"{BASE}/devices/{DEVICE_ID}/sessions/{session_id}"
    return f"{BASE}/sessions/{session_id}"


def banner(proj: str, tool: str, detail: str, session_id: str) -> None:
    title = f"{proj}: approve {tool}?"
    message = detail or tool
    if sys.platform == "darwin":
        if not os.path.exists(TERMINAL_NOTIFIER):
            return
        try:
            subprocess.run(
                [
                    TERMINAL_NOTIFIER,
                    "-title", title,
                    "-message", message,
                    "-execute", f"open {session_page_url(session_id)}",
                    "-group", f"claude-hub-approve-{session_id}",
                    "-sound", "Glass",
                ],
                timeout=5,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass
    elif sys.platform == "win32":
        def esc(s: str) -> str:
            return s.replace("'", "''")

        script = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "Add-Type -AssemblyName System.Drawing;"
            "$n = New-Object System.Windows.Forms.NotifyIcon;"
            "$n.Icon = [System.Drawing.SystemIcons]::Exclamation;"
            "$n.Visible = $true;"
            f"$n.BalloonTipTitle = '{esc(title)}';"
            f"$n.BalloonTipText = '{esc(message[:200])}';"
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


def main() -> None:
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except Exception:
        return  # can't parse -> don't interfere

    tool = data.get("tool_name", "")
    session_id = data.get("session_id") or ""
    if tool not in GATED or not session_id:
        return  # not ours -> normal flow

    if not mode_on(session_id):
        return  # toggle off -> emit nothing, normal/auto behavior unchanged

    # Approval mode ON: gate this call through the dashboard.
    tool_input = data.get("tool_input") or {}
    cwd = (data.get("cwd") or "").rstrip("/\\")
    proj = os.path.basename(cwd) if cwd else "Claude"
    detail = tool_input.get("command") or tool_input.get("file_path") or ""
    req_id = str(uuid.uuid4())

    if not post_json("/api/approvals", {
        "id": req_id,
        "sessionId": session_id,
        "tool": tool,
        "input": tool_input,
        "cwd": cwd or None,
        "deviceId": DEVICE_ID,
    }):
        emit("ask", "Claude Hub unreachable")  # dashboard down -> terminal prompt
        return

    banner(proj, tool, str(detail)[:180], session_id)

    deadline = time.time() + POLL_WINDOW_S
    while time.time() < deadline:
        d = get_decision(req_id)
        if d in ("allow", "deny"):
            delete(req_id)
            emit(d, "Decided in Claude Hub")
            return
        if d == "gone":
            emit("ask", "Approval dismissed")
            return
        time.sleep(POLL_EVERY_S)

    delete(req_id)
    emit("ask", "Approval timed out — falling back to terminal")


try:
    main()
except Exception:
    # Never silently proceed on error while gating; let the terminal decide.
    emit("ask", "approve-hook error")
sys.exit(0)
