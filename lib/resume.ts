import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Open a new Terminal.app window and run an arbitrary shell command. */
export async function openTerminal(command: string): Promise<void> {
  const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = [
    'tell application "Terminal"',
    "  activate",
    `  do script "${escaped}"`,
    "end tell",
  ].join("\n");
  await execFileAsync("osascript", ["-e", script]);
}

/** The exact command a resumed terminal will run. */
export function resumeCommand(sessionId: string, cwd: string): string {
  return `cd ${shellQuote(cwd)} && claude --resume ${shellQuote(sessionId)}`;
}

/** The exact command a brand-new session terminal will run. */
export function newSessionCommand(cwd: string, name?: string): string {
  const namePart = name ? ` -n ${shellQuote(name)}` : "";
  return `cd ${shellQuote(cwd)} && claude${namePart}`;
}

/** Open a new Terminal.app window at cwd and resume the given Claude session. */
export async function resumeInTerminal(
  sessionId: string,
  cwd: string,
): Promise<void> {
  await openTerminal(resumeCommand(sessionId, cwd));
}

/** Open a new Terminal.app window at cwd and start a fresh Claude session. */
export async function startSessionInTerminal(
  cwd: string,
  name?: string,
): Promise<void> {
  await openTerminal(newSessionCommand(cwd, name));
}

/**
 * The tty a live `claude` process (this pid) is attached to, or null.
 * Returns null if the pid is dead, isn't a claude process (PID reuse), or has
 * no controlling terminal (background/daemon).
 */
async function claudeTtyForPid(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "tty=,comm=",
      "-p",
      String(pid),
    ]);
    const line = stdout.trim();
    if (!line) return null; // dead
    const m = line.match(/^(\S+)\s+(.*)$/);
    if (!m) return null;
    const ttyRaw = m[1];
    const comm = m[2];
    if (!/claude/i.test(comm)) return null; // pid reused by some other process
    if (ttyRaw === "??" || ttyRaw === "?") return null; // no terminal (daemon)
    return ttyRaw.startsWith("/dev/") ? ttyRaw : `/dev/${ttyRaw}`;
  } catch {
    return null;
  }
}

/**
 * If a Terminal.app tab is attached to the given tty, bring it to the front.
 * Terminal is only activated when a matching tab is actually found. We also
 * AXRaise the window via System Events so macOS switches Spaces to it when the
 * window lives on another Space / behind a full-screen app.
 */
async function focusTerminalByTty(tty: string): Promise<boolean> {
  const target = tty.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = [
    'tell application "Terminal"',
    "  set winFound to missing value",
    "  repeat with w in windows",
    "    repeat with t in tabs of w",
    "      try",
    `        if (tty of t) is "${target}" then`,
    "          set selected of t to true",
    "          set winFound to w",
    "          exit repeat",
    "        end if",
    "      end try",
    "    end repeat",
    "    if winFound is not missing value then exit repeat",
    "  end repeat",
    "  if winFound is missing value then return \"notfound\"",
    "  try",
    "    if miniaturized of winFound then set miniaturized of winFound to false",
    "  end try",
    "  set frontmost of winFound to true",
    "  activate",
    "end tell",
    "try",
    '  tell application "System Events" to tell process "Terminal"',
    "    set frontmost to true",
    '    perform action "AXRaise" of window 1',
    "  end tell",
    "end try",
    'return "focused"',
  ].join("\n");
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    return stdout.trim() === "focused";
  } catch {
    return false;
  }
}

/**
 * Try to bring an already-open session terminal to the foreground.
 * Only succeeds when an actual Terminal.app tab for the session is found.
 */
export async function focusSessionTerminal(pids: number[]): Promise<boolean> {
  for (const pid of pids) {
    const tty = await claudeTtyForPid(pid);
    if (tty && (await focusTerminalByTty(tty))) return true;
  }
  return false;
}
