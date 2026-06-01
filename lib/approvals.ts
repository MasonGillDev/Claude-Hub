import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HUB_DIR = path.join(os.homedir(), ".claude-hub");
const MODE_FILE = path.join(HUB_DIR, "approval-mode.json");
const APPROVALS_FILE = path.join(HUB_DIR, "approvals.json");

/** Pending hook requests older than this are pruned (the hook should have cleaned up). */
const STALE_MS = 2 * 60 * 1000;
/**
 * SDK approvals are owned by the session daemon, which deletes them on decision
 * or abort. Unlike the hook (a blocking subprocess capped at ~20s), an SDK
 * session can pause and wait for a human, so these get a much longer safety-net
 * TTL — only pruned if the daemon died without cleaning up.
 */
const STALE_MS_SDK = 30 * 60 * 1000;

export type Decision = "pending" | "allow" | "deny";

export interface Approval {
  id: string;
  sessionId: string;
  tool: string;
  /** Raw tool input (e.g. { command } for Bash, { file_path } for Edit). */
  input: Record<string, unknown>;
  cwd: string | null;
  createdAt: string;
  decision: Decision;
  /**
   * Who created the request: the PreToolUse hook (terminal sessions) or the
   * session daemon's canUseTool (SDK sessions). Controls the prune TTL.
   * Defaults to "hook" for back-compat with existing entries.
   */
  source?: "hook" | "sdk";
}

// ---------------------------------------------------------------------------
// Per-session approval mode (the toggle)
// ---------------------------------------------------------------------------

function loadModes(): Record<string, boolean> {
  try {
    return JSON.parse(fs.readFileSync(MODE_FILE, "utf8")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveModes(modes: Record<string, boolean>): void {
  fs.mkdirSync(HUB_DIR, { recursive: true });
  fs.writeFileSync(MODE_FILE, JSON.stringify(modes, null, 2));
}

export function getApprovalMode(sessionId: string): boolean {
  return loadModes()[sessionId] === true;
}

export function setApprovalMode(sessionId: string, on: boolean): void {
  const modes = loadModes();
  if (on) modes[sessionId] = true;
  else delete modes[sessionId];
  saveModes(modes);
}

// ---------------------------------------------------------------------------
// Pending approvals store
// ---------------------------------------------------------------------------

function loadApprovals(): Record<string, Approval> {
  try {
    return JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf8")) as Record<string, Approval>;
  } catch {
    return {};
  }
}

function saveApprovals(store: Record<string, Approval>): void {
  fs.mkdirSync(HUB_DIR, { recursive: true });
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(store, null, 2));
}

/** Drop entries older than STALE_MS (defensive cleanup if a hook died). */
function prune(store: Record<string, Approval>): Record<string, Approval> {
  const now = Date.now();
  let changed = false;
  for (const [id, a] of Object.entries(store)) {
    const ttl = a.source === "sdk" ? STALE_MS_SDK : STALE_MS;
    if (now - new Date(a.createdAt).getTime() > ttl) {
      delete store[id];
      changed = true;
    }
  }
  if (changed) saveApprovals(store);
  return store;
}

export function createApproval(
  a: Omit<Approval, "createdAt" | "decision">,
): Approval {
  const store = prune(loadApprovals());
  const approval: Approval = {
    ...a,
    source: a.source ?? "hook",
    createdAt: new Date().toISOString(),
    decision: "pending",
  };
  store[a.id] = approval;
  saveApprovals(store);
  return approval;
}

export function getApproval(id: string): Approval | null {
  return loadApprovals()[id] ?? null;
}

export function listPendingApprovals(): Approval[] {
  return Object.values(prune(loadApprovals()))
    .filter((a) => a.decision === "pending")
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

export function decideApproval(id: string, decision: "allow" | "deny"): Approval | null {
  const store = loadApprovals();
  if (!store[id]) return null;
  store[id].decision = decision;
  saveApprovals(store);
  return store[id];
}

export function deleteApproval(id: string): void {
  const store = loadApprovals();
  if (store[id]) {
    delete store[id];
    saveApprovals(store);
  }
}

/** sessionIds that currently have a pending approval. */
export function pendingApprovalSessionIds(): string[] {
  return listPendingApprovals().map((a) => a.sessionId);
}
