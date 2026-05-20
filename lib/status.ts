import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HUB_DIR = path.join(os.homedir(), ".claude-hub");
const FILE = path.join(HUB_DIR, "status.json");

/** Manual, user-set lifecycle flag for a session. */
export type SessionStatus = "open" | "finished";

type Store = Record<string, SessionStatus>;

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

export function getStatuses(): Store {
  return load();
}

export function getStatusFor(sessionId: string): SessionStatus | null {
  return load()[sessionId] ?? null;
}

export function setStatus(sessionId: string, status: SessionStatus | null): void {
  const store = load();
  if (status) store[sessionId] = status;
  else delete store[sessionId];
  save(store);
}
