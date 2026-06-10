import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HUB_DIR = path.join(os.homedir(), ".claude-hub");
const FILE = path.join(HUB_DIR, "attention.json");

export type AttentionEvent = "done" | "needs_input" | "subagent_done";

export interface AttentionEntry {
  event: AttentionEvent;
  message: string | null;
  at: string;
  cwd: string | null;
  /** Registry id of the device the session lives on; null/absent = this machine. */
  deviceId?: string | null;
}

type Store = Record<string, AttentionEntry>;

function load(): Store {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Store;
  } catch {
    return {};
  }
}

function save(store: Store): void {
  fs.mkdirSync(HUB_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

export function getAttention(): Store {
  return load();
}

export function getAttentionFor(sessionId: string): AttentionEntry | null {
  return load()[sessionId] ?? null;
}

export function setAttention(
  sessionId: string,
  event: AttentionEvent,
  message: string | null,
  cwd: string | null,
  deviceId: string | null = null,
): void {
  const store = load();
  store[sessionId] = { event, message, at: new Date().toISOString(), cwd, deviceId };
  save(store);
}

export function clearAttention(sessionId: string): void {
  const store = load();
  if (store[sessionId]) {
    delete store[sessionId];
    save(store);
  }
}

export function clearAllAttention(): void {
  save({});
}

/** Drop attention for any session that is currently running — it can't also need you. */
export function clearAttentionForRunning(runningIds: Iterable<string>): void {
  const store = load();
  let changed = false;
  for (const id of runningIds) {
    if (store[id]) {
      delete store[id];
      changed = true;
    }
  }
  if (changed) save(store);
}

/** Map a Claude Code hook event name to an attention event (or "clear"). */
export function mapHookEvent(
  hookEventName: string,
): AttentionEvent | "clear" | null {
  switch (hookEventName) {
    case "Stop":
      return "done";
    case "SubagentStop":
      return "subagent_done";
    case "Notification":
      return "needs_input";
    case "UserPromptSubmit":
      return "clear";
    default:
      return null;
  }
}
