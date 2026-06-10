import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PROJECTS_DIR,
  SESSIONS_DIR,
  decodeProjectId,
  findSessionFile,
  firstCwd,
  getSessionDetail as coreGetSessionDetail,
  jsonlFilesIn,
  listProjects as coreListProjects,
  listSessions as coreListSessions,
  loadCliRunningSessions,
  readJson,
  safeReadDir,
  type CoreProject,
  type CoreSession,
  type CoreSessionDetail,
  type Interaction,
  type Recap,
} from "@/core/index";
import { getAttention, getAttentionFor, type AttentionEntry } from "./attention";
import { getStatuses, getStatusFor, type SessionStatus } from "./status";
import { getApprovalMode, pendingApprovalSessionIds } from "./approvals";
import { loadDaemonRunning } from "./daemonLive";

/**
 * Hub-side view of the LOCAL device's Claude data: the portable read layer in
 * `core/` plus everything that only exists on this machine — sidecar custom
 * names, open/finished status, attention, approvals, and the SDK daemon's
 * live sessions. Remote devices go through `lib/agentClient.ts` instead.
 */

export type { Interaction, Recap };

// Our own sidecar store for names set inside this app, so we never write to
// Claude's live session state. Keyed by sessionId.
const HUB_DIR = path.join(os.homedir(), ".claude-hub");
const NAMES_FILE = path.join(HUB_DIR, "names.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project extends CoreProject {
  /** Number of sessions in this project currently needing attention. */
  attentionCount: number;
  /** Number of sessions in this project with a tool call awaiting approval. */
  pendingApprovalCount: number;
}

export interface SessionSummary extends Omit<CoreSession, "nameSource"> {
  /** Source of the resolved name, for UI hinting. */
  nameSource: "custom" | "job" | "title" | "prompt" | "id";
  /** Custom name set inside this app, if any. */
  customName: string | null;
  /** Pending attention event for this session, if any. */
  attention: AttentionEntry | null;
  /** Manual user-set lifecycle flag (open = more to do, finished = good state). */
  status: SessionStatus | null;
  /** Whether "approve tool calls from the dashboard" is enabled for this session. */
  approvalMode: boolean;
  /** Whether a tool call is currently waiting for approval. */
  pendingApproval: boolean;
}

export interface SessionDetail extends SessionSummary {
  model: string | null;
  version: string | null;
  lastUser: Interaction | null;
  lastAssistant: Interaction | null;
  /** Most recent away recap, if Claude Code generated one. */
  recap: Recap | null;
}

// ---------------------------------------------------------------------------
// Sidecar custom-name store
// ---------------------------------------------------------------------------

function loadCustomNames(): Record<string, string> {
  return readJson<Record<string, string>>(NAMES_FILE) ?? {};
}

function saveCustomNames(names: Record<string, string>): void {
  fs.mkdirSync(HUB_DIR, { recursive: true });
  fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2));
}

// ---------------------------------------------------------------------------
// Running set: CLI sessions ∪ SDK-daemon sessions
// ---------------------------------------------------------------------------

/**
 * Set of sessionIds with a live, busy process — from two feeds, unioned:
 *  - the terminal CLI's `~/.claude/sessions/*.json` (status: "busy"), and
 *  - the SDK daemon's `~/.claude-hub/daemon-live.json` (sessions it's driving).
 * So an in-app session shows "running" exactly like a terminal one.
 */
function loadRunningSessions(): Set<string> {
  const set = loadCliRunningSessions();
  for (const id of loadDaemonRunning()) set.add(id);
  return set;
}

// ---------------------------------------------------------------------------
// Hub overlays
// ---------------------------------------------------------------------------

interface SummaryContext {
  customNames: Record<string, string>;
  attention: Record<string, AttentionEntry>;
  statuses: Record<string, SessionStatus>;
  pendingApprovals: Set<string>;
}

function loadSummaryContext(): SummaryContext {
  return {
    customNames: loadCustomNames(),
    attention: getAttention(),
    statuses: getStatuses(),
    pendingApprovals: new Set(pendingApprovalSessionIds()),
  };
}

/** Layer hub-only state (custom name, attention, status, approvals) onto a core session. */
function decorateSession(s: CoreSession, ctx: SummaryContext): SessionSummary {
  const custom = ctx.customNames[s.id] ?? null;
  return {
    ...s,
    name: custom ?? s.name,
    nameSource: custom ? "custom" : s.nameSource,
    customName: custom,
    // Running (busy) suppresses attention — a session can't be both.
    attention: s.running ? null : (ctx.attention[s.id] ?? null),
    status: ctx.statuses[s.id] ?? null,
    approvalMode: getApprovalMode(s.id),
    pendingApproval: ctx.pendingApprovals.has(s.id),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getProjects(): Project[] {
  const runningSet = loadRunningSessions();

  // Tally pending attention per project. A running session can't also need
  // you, so running always wins — skip those when counting attention.
  const attentionByProject: Record<string, number> = {};
  for (const sid of Object.keys(getAttention())) {
    if (runningSet.has(sid)) continue;
    const found = findSessionFile(sid);
    if (found) {
      attentionByProject[found.projectId] =
        (attentionByProject[found.projectId] ?? 0) + 1;
    }
  }

  // Tally sessions with a pending tool-call approval per project.
  const pendingApprovalByProject: Record<string, number> = {};
  for (const sid of pendingApprovalSessionIds()) {
    const found = findSessionFile(sid);
    if (found) {
      pendingApprovalByProject[found.projectId] =
        (pendingApprovalByProject[found.projectId] ?? 0) + 1;
    }
  }

  return coreListProjects({ runningIds: runningSet }).map((p) => ({
    ...p,
    attentionCount: attentionByProject[p.id] ?? 0,
    pendingApprovalCount: pendingApprovalByProject[p.id] ?? 0,
  }));
}

export function getProject(projectId: string): Project | null {
  return getProjects().find((p) => p.id === projectId) ?? null;
}

export function getSessions(projectId: string): SessionSummary[] {
  const running = loadRunningSessions();
  const ctx = loadSummaryContext();
  return coreListSessions(projectId, { runningIds: running }).map((s) =>
    decorateSession(s, ctx),
  );
}

export function getSession(sessionId: string): SessionDetail | null {
  const running = loadRunningSessions();
  const detail = coreGetSessionDetail(sessionId, { runningIds: running });
  if (!detail) return null;

  const ctx = loadSummaryContext();
  const { model, version, lastUser, lastAssistant, recap, ...summary } = detail;
  return {
    ...decorateSession(summary as CoreSession, ctx),
    model,
    version,
    lastUser,
    lastAssistant,
    recap,
  };
}

/** Set (or clear, with empty string) the custom name for a session. */
export function renameSession(sessionId: string, name: string): SessionDetail | null {
  const found = findSessionFile(sessionId);
  if (!found) return null;
  const names = loadCustomNames();
  const trimmed = name.trim();
  if (trimmed) names[sessionId] = trimmed;
  else delete names[sessionId];
  saveCustomNames(names);
  return getSession(sessionId);
}

export function deleteSession(sessionId: string): boolean {
  const found = findSessionFile(sessionId);
  if (!found) return false;
  fs.rmSync(found.file, { force: true });
  const names = loadCustomNames();
  if (names[sessionId]) {
    delete names[sessionId];
    saveCustomNames(names);
  }
  return true;
}

/** Delete an entire project directory (all of its sessions). Guarded against traversal. */
export function deleteProject(projectId: string): boolean {
  // projectId must be a single path segment (no separators / parent refs).
  if (projectId.includes("/") || projectId.includes("\\") || projectId.includes("..")) {
    return false;
  }
  const dir = path.resolve(PROJECTS_DIR, projectId);
  const base = path.resolve(PROJECTS_DIR);
  if (dir === base || !dir.startsWith(base + path.sep)) return false;
  if (!fs.existsSync(dir)) return false;

  // Clean up any sidecar custom names for sessions in this project.
  const sessionIds = jsonlFilesIn(dir).map((f) => f.replace(/\.jsonl$/, ""));
  const names = loadCustomNames();
  let changed = false;
  for (const id of sessionIds) {
    if (names[id]) {
      delete names[id];
      changed = true;
    }
  }
  if (changed) saveCustomNames(names);

  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Validate a directory path for starting a new session. */
export function validateDirectory(
  dirPath: string,
): { ok: true; path: string } | { ok: false; error: string } {
  if (!dirPath || !dirPath.trim()) {
    return { ok: false, error: "Path is required" };
  }
  let resolved = dirPath.trim();
  if (resolved.startsWith("~")) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  resolved = path.resolve(resolved);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, error: `No such directory: ${resolved}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: `Not a directory: ${resolved}` };
  }
  return { ok: true, path: resolved };
}

/** Whether a session's transcript file exists. */
export function sessionExists(sessionId: string): boolean {
  return findSessionFile(sessionId) !== null;
}

/** Session ids that currently have a live (busy) process. */
export function getRunningSessionIds(): string[] {
  return Array.from(loadRunningSessions());
}

/** PIDs registered for a session in ~/.claude/sessions (may include stale ones). */
export function getSessionDaemonPids(sessionId: string): number[] {
  const pids: number[] = [];
  for (const f of safeReadDir(SESSIONS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const info = readJson<{ sessionId?: string; pid?: number }>(
      path.join(SESSIONS_DIR, f),
    );
    if (info?.sessionId === sessionId && typeof info.pid === "number") {
      pids.push(info.pid);
    }
  }
  return pids;
}

/** Resolve the cwd to launch a resumed session in. */
export function getSessionCwd(sessionId: string): string | null {
  const found = findSessionFile(sessionId);
  if (!found) return null;
  return firstCwd(found.file) ?? decodeProjectId(found.projectId);
}
