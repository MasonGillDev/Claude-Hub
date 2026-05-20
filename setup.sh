#!/usr/bin/env bash
# Claude Hub — set up the external hooks on this Mac.
#
# Installs the notify/approve hook scripts into ~/.claude-hub/ and wires them
# into ~/.claude/settings.json (PreToolUse + Stop/Notification/SubagentStop/
# UserPromptSubmit). Idempotent and re-runnable: it replaces any prior
# claude-hub hook entries and backs up settings.json before touching it.
#
# This sets up the notifications + tool-call-approval half of Claude Hub.
# The dashboard app itself is separate: run ./install-node.sh (or use any
# Node 18.18+/20+), then `npm install` && `npm run dev`.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HUB_DIR="$HOME/.claude-hub"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"

echo "==> Installing hook scripts into $HUB_DIR ..."
mkdir -p "$HUB_DIR"
cp "$REPO_DIR/hooks/notify-hook.py"  "$HUB_DIR/notify-hook.py"
cp "$REPO_DIR/hooks/approve-hook.py" "$HUB_DIR/approve-hook.py"
chmod +x "$HUB_DIR/notify-hook.py" "$HUB_DIR/approve-hook.py"

echo "==> Wiring hooks into $SETTINGS ..."
mkdir -p "$CLAUDE_DIR"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"

NOTIFY="$HUB_DIR/notify-hook.py" APPROVE="$HUB_DIR/approve-hook.py" \
SETTINGS="$SETTINGS" python3 - <<'PY'
import json, os

settings = os.environ["SETTINGS"]
notify   = os.environ["NOTIFY"]
approve  = os.environ["APPROVE"]

with open(settings) as f:
    cfg = json.load(f)

hooks = cfg.setdefault("hooks", {})

def strip_ours(event):
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

# PreToolUse -> approve-hook (gated tools only; 30s > the script's ~20s poll).
hooks.setdefault("PreToolUse", []).append({
    "matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit",
    "hooks": [{"type": "command", "command": approve, "timeout": 30}],
})

# Stop / Notification / SubagentStop / UserPromptSubmit -> notify-hook.
for ev in ("Stop", "Notification", "SubagentStop", "UserPromptSubmit"):
    hooks.setdefault(ev, []).append({
        "hooks": [{"type": "command", "command": notify}],
    })

with open(settings, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
print("    settings.json updated.")
PY

echo "==> Checking optional clickable-banner support (terminal-notifier) ..."
if [ -x "$HUB_DIR/terminal-notifier.app/Contents/MacOS/terminal-notifier" ]; then
  echo "    Found — banners will be clickable (focus/resume the session)."
else
  echo "    Not installed (optional). Banners still work via osascript, but"
  echo "    won't be clickable. To enable clickable banners, place a"
  echo "    terminal-notifier.app bundle at:"
  echo "      $HUB_DIR/terminal-notifier.app"
  echo "    (https://github.com/julienXX/terminal-notifier/releases)"
fi

cat <<EOF

==> Hooks installed. Now start the dashboard:
      ./install-node.sh        # if you don't already have Node 18.18+/20+
      npm install
      npm run dev              # http://127.0.0.1:3000

    Notes:
      - The app must run on port 3000 (the hooks POST to 127.0.0.1:3000).
        Override with the CLAUDE_HUB_PORT env var if needed.
      - Restart Claude Code so it picks up the new settings.json hooks.
      - A settings.json backup was written next to it (settings.json.bak.*).
EOF
