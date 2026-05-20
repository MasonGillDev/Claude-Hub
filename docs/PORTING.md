# Porting Claude Hub to Linux & Windows

A best-effort guide to running Claude Hub off macOS. It's honest about which
parts port cleanly, which need rewriting, and which are architecturally Mac-only.

## TL;DR

The split is clean:

- **Everything that *reads* Claude's data is already portable** and runs on
  Windows/Linux today.
- **Everything that *acts on a terminal or shows a native banner* is macOS-only**,
  and currently *hard-fails* off macOS (there are no platform guards).
- The escape hatch: if the dashboard **owns** sessions (Agent SDK / `claude -p`),
  the terminal layer disappears and the hardest gap (Focus) becomes moot — on
  every OS at once. See [TODO.md](../TODO.md) → "Big bet."

## Portability matrix

| Component | macOS | Linux | Windows | Notes |
|---|---|---|---|---|
| Dashboard UI + REST API | ✅ | ✅ | ✅ | Pure Node/React |
| Data reads (`lib/claude.ts`, sidecars) | ✅ | ✅ | ✅ | `os.homedir()` + `path.join`/`path.sep`; `CLAUDE_CONFIG_DIR` honored |
| In-app bell / pulse (`/api/events`) | ✅ | ✅ | ✅ | Just polls; works once hooks POST to it |
| **Resume** (open new terminal, run `claude --resume`) | ✅ | ⚠️ rewrite | ⚠️ rewrite | Launchable everywhere; no shared mechanism |
| **Focus** (raise the *existing* session's tab) | ✅ | ❌ mostly | ❌ | Architectural — see below |
| Native notification banner | ✅ | ⚠️ swap | ⚠️ swap | `osascript`/`terminal-notifier` → `notify-send` / Windows toast |
| Hook scripts (POST half) | ✅ | ✅ | ✅ | Python `urllib`, cross-platform |
| Hook wiring in `settings.json` | ✅ | ✅ | ⚠️ | Windows can't exec a `.py` `command` directly |
| `install-node.sh` | ✅ | ⚠️ | ❌ | Hardcoded `darwin-arm64`; bash + `~/.zshrc` |
| `setup.sh` | ✅ | ✅ | ⚠️ WSL | `python3` merge is portable; bash needs WSL/Git Bash on Windows |

## The hard part: Resume vs. Focus

These are two *different* capabilities lumped into `lib/resume.ts`.

### Resume — "open a new terminal and run `cd <cwd> && claude --resume <id>`"
Possible on **all** OSs; only the launch mechanism differs.

- macOS: `osascript` → Terminal.app `do script` (`resume.ts:11-19`).
- Linux: spawn an installed emulator — `gnome-terminal --`, `konsole -e`,
  `xterm -e`, or `x-terminal-emulator`. No canonical mechanism → must detect.
  Fails headless/over SSH (no GUI terminal).
- Windows: `wt.exe new-tab -d <cwd> <cmd>` (Windows Terminal) or `start cmd /k`.

### Focus — "raise the *already-running* session's exact tab"
**macOS-only in practice.** Needs pid → tty → *which window/tab hosts that tty*
→ raise window + select tab. The mac trick is Terminal.app exposing `tty of tab`
over AppleScript (`resume.ts:82-120`). No equivalent elsewhere:

- **Linux:** pid→tty is fine (`/proc`). tty→tab is the wall — emulators don't
  expose "which tab owns tty X." You can raise the *window* (`wmctrl`/`xdotool`,
  EWMH `_NET_WM_PID`) on **X11**, but **Wayland forbids client-driven window
  activation by design** (only compositor IPC like `swaymsg`, or `xdg-activation`
  token handoff). Selecting the right *tab* is generally impossible.
- **Windows:** no tty concept; Windows Terminal hosts many tabs in one process
  via ConPTY with no public pid→tab API; `SetForegroundWindow` is restricted
  (background apps flash the taskbar instead of raising). Classic `conhost`
  windows are partially tractable.

**Conclusion:** don't try to port Focus. Degrade it to Resume: try-focus on
macOS, else always open a fresh `claude --resume` terminal. The code already uses
that try-then-fallback shape, so the degradation is natural.

## Best-effort Linux port

1. **Node:** skip `install-node.sh`; install Node 18.18+/20+ via your package
   manager or nvm. The app then runs as-is (`npm install && npm run dev`).
2. **`lib/resume.ts`:** add a platform dispatch.
   - Detect emulator (`$TERMINAL`, then `gnome-terminal`/`konsole`/`xterm`/
     `x-terminal-emulator`). Launch `<emu> -e bash -lc "<resumeCommand>"`.
   - For Focus: best-effort window raise on X11 via `wmctrl -ia` using the
     emulator's `_NET_WM_PID`; on Wayland, skip Focus and just Resume.
   - **Wrap `openTerminal` and friends in try/catch** so a missing emulator
     returns a clean error, not a 500.
3. **Banners:** in the hooks, replace the `osascript`/`terminal-notifier` branch
   with `notify-send` (libnotify). The POST-to-dashboard half is already portable.
4. **`setup.sh`:** works as-is, except the `~/.zshrc` PATH edit in
   `install-node.sh` should target the user's actual shell rc (`~/.bashrc`).
5. Estimated effort: a few hours; Resume + in-app bell + `notify-send` banners
   give ~80% of the macOS experience (you lose tab-precise Focus).

## Best-effort Windows port

Heavier — bash scripts and the `.py` hook command both need attention.

1. **Node:** install Node for Windows normally. Run the app from PowerShell.
2. **`setup.sh` / `install-node.sh`:** don't run natively. Either use WSL/Git
   Bash, or port the logic to PowerShell. The `settings.json` merge logic is
   simple JSON — re-implement in PowerShell or Node.
3. **Hook `command` wiring:** Claude Code can't execute a `.py` file directly on
   Windows. Wire it as `python C:\Users\<you>\.claude-hub\notify-hook.py`
   (and same for `approve-hook.py`) in `settings.json`.
4. **`lib/resume.ts`:** dispatch to `wt.exe new-tab -d <cwd> cmd /k "<cmd>"`
   (or `start`). **Skip Focus entirely** — no reliable pid→tab or foreground
   API. Wrap launches in try/catch.
5. **Banners:** swap to a Windows toast (e.g. PowerShell
   `New-BurntToastNotification`, or a small toast helper). POST half is portable.

## The shortcut that dodges most of this

If you pursue the **UI-owns-the-session** direction (TODO.md → "Big bet"),
Resume *and* Focus *and* the per-OS terminal launchers all become optional,
because there's no terminal to manage — the dashboard holds stdin/stdout via the
Agent SDK. Verified resumability is creation-agnostic (a `-p`/SDK session writes
the same JSONL and `claude --resume <id>` reopens it), so users can still drop to
a terminal when they want, on whatever OS. Porting the GUI-terminal glue may not
be worth it if that direction lands first.

## Testing checklist (per OS)

- [ ] `npm run dev` serves the dashboard; projects/sessions list correctly.
- [ ] Rename / open-finished status persist to `~/.claude-hub/` sidecars.
- [ ] Hooks POST to `/api/events` → in-app bell/pulse lights up.
- [ ] Native banner appears for Stop/Notification (or is cleanly absent).
- [ ] Resume opens a terminal running `claude --resume <id>` in the right cwd.
- [ ] `/api/sessions/[id]/resume` returns a clean error (not 500) when no GUI
      terminal is available.
