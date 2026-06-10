#!/usr/bin/env python3
"""Cross-platform installer for the Claude Hub hooks (macOS + Windows).

Copies notify-hook.py / approve-hook.py into ~/.claude-hub/, optionally points
them at a remote hub (hub.json), and wires them into ~/.claude/settings.json
(PreToolUse + Stop/Notification/SubagentStop/UserPromptSubmit). Idempotent:
re-runs replace any prior claude-hub hook entries, and settings.json is backed
up first.

On the hub machine itself (the Mac running the dashboard), run with no args —
hooks talk to http://127.0.0.1:3000 as before. On other devices, point at the
hub and identify this device with its id from the hub's devices.json:

    python3 install.py --hub-url http://192.168.1.141:3000 --device-id masonpc

(`python install.py ...` on Windows.) Restart Claude Code afterwards so it
picks up the new settings.json hooks.
"""
import argparse
import json
import os
import shutil
import stat
import sys
import time

HOOKS = ("notify-hook.py", "approve-hook.py")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--hub-url",
        help="Dashboard origin, e.g. http://192.168.1.141:3000. "
        "Omit on the hub machine itself (defaults to localhost).",
    )
    parser.add_argument(
        "--device-id",
        help="This device's id in the hub's ~/.claude-hub/devices.json. "
        "Required with --hub-url so the hub links events to the right device.",
    )
    args = parser.parse_args()

    if args.hub_url and not args.device_id:
        parser.error("--device-id is required when --hub-url is set")
    if args.device_id and not args.hub_url:
        parser.error("--hub-url is required when --device-id is set")

    src_dir = os.path.dirname(os.path.abspath(__file__))
    hub_dir = os.path.expanduser("~/.claude-hub")
    claude_dir = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    settings_path = os.path.join(claude_dir, "settings.json")

    # 1) Install the hook scripts.
    os.makedirs(hub_dir, exist_ok=True)
    for name in HOOKS:
        dst = os.path.join(hub_dir, name)
        shutil.copyfile(os.path.join(src_dir, name), dst)
        if os.name == "posix":
            os.chmod(dst, os.stat(dst).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print(f"==> Installed {', '.join(HOOKS)} into {hub_dir}")

    # 2) Point them at the hub (remote devices only).
    hub_config = os.path.join(hub_dir, "hub.json")
    if args.hub_url:
        with open(hub_config, "w") as f:
            json.dump({"url": args.hub_url.rstrip("/"), "deviceId": args.device_id}, f, indent=2)
            f.write("\n")
        print(f"==> Wrote {hub_config} -> {args.hub_url} (device: {args.device_id})")
    elif os.path.exists(hub_config):
        print(f"==> Keeping existing {hub_config} (pass --hub-url to overwrite)")
    else:
        print("==> No --hub-url: hooks will use the local dashboard at 127.0.0.1:3000")

    # 3) Wire into ~/.claude/settings.json.
    os.makedirs(claude_dir, exist_ok=True)
    cfg = {}
    if os.path.exists(settings_path):
        shutil.copyfile(settings_path, f"{settings_path}.bak.{time.strftime('%Y%m%d%H%M%S')}")
        try:
            with open(settings_path) as f:
                cfg = json.load(f)
        except Exception:
            sys.exit(f"ERROR: {settings_path} is not valid JSON — fix it and re-run.")

    hooks = cfg.setdefault("hooks", {})

    def strip_ours(event: str) -> None:
        """Drop any existing claude-hub hook entries so re-runs don't duplicate."""
        groups = hooks.get(event, [])
        kept = []
        for g in groups:
            g = dict(g)
            g["hooks"] = [
                h for h in g.get("hooks", [])
                if "notify-hook.py" not in h.get("command", "")
                and "approve-hook.py" not in h.get("command", "")
            ]
            if g["hooks"]:
                kept.append(g)
        if kept:
            hooks[event] = kept
        else:
            hooks.pop(event, None)

    for ev in ("PreToolUse", "Stop", "Notification", "SubagentStop", "UserPromptSubmit"):
        strip_ours(ev)

    def command_for(script: str) -> str:
        path = os.path.join(hub_dir, script)
        if os.name == "nt":
            # No shebangs on Windows — invoke the interpreter explicitly.
            return f'"{sys.executable}" "{path}"'
        return path

    # PreToolUse -> approve-hook (gated tools only; 30s > the script's ~20s poll).
    hooks.setdefault("PreToolUse", []).append({
        "matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [{"type": "command", "command": command_for("approve-hook.py"), "timeout": 30}],
    })

    # Stop / Notification / SubagentStop / UserPromptSubmit -> notify-hook.
    for ev in ("Stop", "Notification", "SubagentStop", "UserPromptSubmit"):
        hooks.setdefault(ev, []).append({
            "hooks": [{"type": "command", "command": command_for("notify-hook.py")}],
        })

    with open(settings_path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    print(f"==> Wired hooks into {settings_path}")
    print("==> Done. Restart Claude Code so it picks up the new hooks.")


if __name__ == "__main__":
    main()
