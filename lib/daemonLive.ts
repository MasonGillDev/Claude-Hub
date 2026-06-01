import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Sidecar that bridges the session daemon to the dashboard's "running" view.
 *
 * The daemon owns its live SDK sessions in memory; the Next app only reads disk.
 * Rather than have Next call the daemon over HTTP on every render, the daemon
 * publishes its busy sessions here and `lib/claude.ts` unions them into the same
 * running-set the terminal CLI's `~/.claude/sessions/*.json` feed. The file is the
 * contract — same decoupling the notify-hook already uses for attention.json.
 *
 * Liveness is tracked by a single daemon-wide `heartbeat` (refreshed on a timer),
 * not per session, so a long model turn doesn't look stale and a daemon crash
 * makes ALL its entries expire at once.
 */

const HUB_DIR = path.join(os.homedir(), ".claude-hub");
const FILE = path.join(HUB_DIR, "daemon-live.json");

/** Heartbeat older than this ⇒ the daemon is presumed dead; ignore its sessions. */
export const DAEMON_STALE_MS = 30_000;

interface SessionEntry {
  cwd: string;
  busy: boolean;
  since: string;
}
interface LiveFile {
  heartbeat: string;
  sessions: Record<string, SessionEntry>;
}

function load(): LiveFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<LiveFile>;
    return { heartbeat: parsed.heartbeat ?? "", sessions: parsed.sessions ?? {} };
  } catch {
    return { heartbeat: "", sessions: {} };
  }
}

function save(file: LiveFile): void {
  fs.mkdirSync(HUB_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(file, null, 2));
}

// --- daemon side (writer) ----------------------------------------------------

/** Set a session's busy state; (re)writes the heartbeat. */
export function publishDaemonSession(id: string, cwd: string, busy: boolean): void {
  const file = load();
  const since = file.sessions[id]?.since ?? new Date().toISOString();
  file.sessions[id] = { cwd, busy, since };
  file.heartbeat = new Date().toISOString();
  save(file);
}

/** Drop a session entirely (session ended). */
export function unpublishDaemonSession(id: string): void {
  const file = load();
  if (file.sessions[id]) {
    delete file.sessions[id];
    file.heartbeat = new Date().toISOString();
    save(file);
  }
}

/** Refresh the heartbeat so live sessions don't look stale during a long turn. */
export function touchDaemonHeartbeat(): void {
  const file = load();
  if (Object.keys(file.sessions).length === 0) return; // nothing to keep alive
  file.heartbeat = new Date().toISOString();
  save(file);
}

// --- reader side (Next) ------------------------------------------------------

/** Session ids busy in the daemon, while the daemon's heartbeat is fresh. */
export function loadDaemonRunning(): Set<string> {
  const file = load();
  const set = new Set<string>();
  if (!file.heartbeat) return set;
  if (Date.now() - new Date(file.heartbeat).getTime() > DAEMON_STALE_MS) return set;
  for (const [id, e] of Object.entries(file.sessions)) {
    if (e.busy) set.add(id);
  }
  return set;
}
