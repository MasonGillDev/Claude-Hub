import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAttention, getAttentionFor, type AttentionEntry } from "./attention";
import { getStatuses, getStatusFor, type SessionStatus } from "./status";
import { getApprovalMode, pendingApprovalSessionIds } from "./approvals";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const JOBS_DIR = path.join(CLAUDE_DIR, "jobs");
const SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");

// Our own sidecar store for names set inside this app, so we never write to
// Claude's live session state. Keyed by sessionId.
const HUB_DIR = path.join(HOME, ".claude-hub");
const NAMES_FILE = path.join(HUB_DIR, "names.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  /** Encoded directory name, e.g. "-Users-masongill-Claude-Hub". URL-safe id. */
  id: string;
  /** Best-effort real working directory, e.g. "/Users/masongill/Claude Hub". */
  path: string;
  /** Friendly label = last segment of the path. */
  name: string;
  sessionCount: number;
  /** ISO timestamp of the most recent session activity. */
  lastActivity: string | null;
  /** Number of sessions in this project currently needing attention. */
  attentionCount: number;
  /** Number of sessions in this project with a live (busy) process. */
  runningCount: number;
  /** Number of sessions in this project with a tool call awaiting approval. */
  pendingApprovalCount: number;
}

export interface SessionSummary {
  id: string;
  projectId: string;
  /** Resolved display name (custom > job name > ai-title > first prompt > id). */
  name: string;
  /** Source of the resolved name, for UI hinting. */
  nameSource: "custom" | "job" | "title" | "prompt" | "id";
  /** Auto-generated AI title, if any. */
  aiTitle: string | null;
  /** Custom name set inside this app, if any. */
  customName: string | null;
  /** First human prompt, trimmed. */
  firstPrompt: string | null;
  /** Most recent human prompt, trimmed. */
  lastPrompt: string | null;
  messageCount: number;
  cwd: string | null;
  gitBranch: string | null;
  lastActivity: string | null;
  createdAt: string | null;
  running: boolean;
  /** Pending attention event for this session, if any. */
  attention: AttentionEntry | null;
  /** Manual user-set lifecycle flag (open = more to do, finished = good state). */
  status: SessionStatus | null;
  /** Whether "approve tool calls from the dashboard" is enabled for this session. */
  approvalMode: boolean;
  /** Whether a tool call is currently waiting for approval. */
  pendingApproval: boolean;
}

export interface Interaction {
  role: "user" | "assistant";
  text: string;
  timestamp: string | null;
  /** Names of tools the assistant invoked in this turn, if any. */
  tools?: string[];
}

export interface Recap {
  /** Claude Code's "away recap" — a short summary of where the session left off. */
  text: string;
  at: string | null;
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
// Low-level helpers
// ---------------------------------------------------------------------------

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Parse a JSONL file into an array of entries, skipping malformed lines. */
function readJsonl(file: string): any[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: any[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // ignore partial / corrupt lines
    }
  }
  return out;
}

/** Pull readable text out of a message `content` field (string or block array). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && b.type === "text" && typeof b.text === "string",
      )
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  return "";
}

/** Tool names invoked in an assistant `content` block array. */
function extractTools(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b && b.type === "tool_use" && typeof b.name === "string")
    .map((b) => b.name as string);
}

function truncate(s: string, n = 280): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
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
// Native job names + live status (read-only)
// ---------------------------------------------------------------------------

interface JobInfo {
  name: string;
  nameSource: string;
  sessionId: string;
}

/** Map of sessionId -> user-set native name, read from ~/.claude/jobs/<short>/state.json. */
function loadJobNames(): Map<string, string> {
  const map = new Map<string, string>();
  for (const short of safeReadDir(JOBS_DIR)) {
    const state = readJson<JobInfo>(path.join(JOBS_DIR, short, "state.json"));
    if (state?.sessionId && state.name && state.nameSource === "user") {
      map.set(state.sessionId, state.name);
    }
  }
  return map;
}

/** Set of sessionIds that currently have a live daemon process. */
function loadRunningSessions(): Set<string> {
  const set = new Set<string>();
  for (const f of safeReadDir(SESSIONS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const info = readJson<{ sessionId?: string; status?: string }>(
      path.join(SESSIONS_DIR, f),
    );
    if (info?.sessionId && info.status === "busy") set.add(info.sessionId);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Session parsing
// ---------------------------------------------------------------------------

function jsonlFilesIn(projectDir: string): string[] {
  return safeReadDir(projectDir).filter((f) => f.endsWith(".jsonl"));
}

/** True if a user entry represents a real human prompt (not a tool result / meta). */
function isHumanPrompt(entry: any): boolean {
  if (entry?.type !== "user") return false;
  if (entry.isMeta) return false;
  const content = entry?.message?.content;
  // tool_result-only arrays contain no text block -> extractText is empty
  return extractText(content).length > 0;
}

interface ParsedSession {
  aiTitle: string | null;
  firstPrompt: string | null;
  lastPrompt: string | null;
  messageCount: number;
  cwd: string | null;
  gitBranch: string | null;
  createdAt: string | null;
  lastActivity: string | null;
  model: string | null;
  version: string | null;
  lastUser: Interaction | null;
  lastAssistant: Interaction | null;
  recap: Recap | null;
}

function parseSession(file: string): ParsedSession {
  const entries = readJsonl(file);
  const res: ParsedSession = {
    aiTitle: null,
    firstPrompt: null,
    lastPrompt: null,
    messageCount: 0,
    cwd: null,
    gitBranch: null,
    createdAt: null,
    lastActivity: null,
    model: null,
    version: null,
    lastUser: null,
    lastAssistant: null,
    recap: null,
  };

  for (const e of entries) {
    const ts: string | null = typeof e.timestamp === "string" ? e.timestamp : null;
    if (ts) {
      if (!res.createdAt) res.createdAt = ts;
      res.lastActivity = ts;
    }
    if (typeof e.cwd === "string") res.cwd = e.cwd;
    if (typeof e.gitBranch === "string") res.gitBranch = e.gitBranch;
    if (typeof e.version === "string") res.version = e.version;

    switch (e.type) {
      case "ai-title":
        if (typeof e.aiTitle === "string") res.aiTitle = e.aiTitle;
        break;
      case "user": {
        if (!isHumanPrompt(e)) break;
        res.messageCount++;
        const text = extractText(e.message?.content);
        if (!res.firstPrompt) res.firstPrompt = text;
        res.lastPrompt = text;
        res.lastUser = { role: "user", text, timestamp: ts };
        break;
      }
      case "assistant": {
        res.messageCount++;
        const content = e.message?.content;
        const text = extractText(content);
        const tools = extractTools(content);
        if (typeof e.message?.model === "string") res.model = e.message.model;
        // Only treat as the "last assistant interaction" if it has visible text
        // or tool calls (skip empty bookkeeping entries).
        if (text || tools.length) {
          res.lastAssistant = { role: "assistant", text, timestamp: ts, tools };
        }
        break;
      }
      case "system": {
        // "Away recap" Claude Code shows when you return after a break. Latest wins.
        if (e.subtype === "away_summary" && typeof e.content === "string") {
          res.recap = { text: cleanRecap(e.content), at: ts };
        }
        break;
      }
    }
  }
  return res;
}

/** Strip the trailing "(disable recaps in /config)" UI hint from a recap. */
function cleanRecap(text: string): string {
  return text.replace(/\s*\(disable recaps in \/config\)\s*$/i, "").trim();
}

/** Cheap scan: read a file and return the first cwd it mentions, without full parse. */
function firstCwd(file: string): string | null {
  const entries = readJsonl(file);
  for (const e of entries) {
    if (typeof e.cwd === "string") return e.cwd;
  }
  return null;
}

function statMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

function resolveName(
  id: string,
  parsed: { aiTitle: string | null; firstPrompt: string | null },
  customNames: Record<string, string>,
  jobNames: Map<string, string>,
): { name: string; nameSource: SessionSummary["nameSource"] } {
  if (customNames[id]) return { name: customNames[id], nameSource: "custom" };
  const job = jobNames.get(id);
  if (job) return { name: job, nameSource: "job" };
  if (parsed.aiTitle) return { name: parsed.aiTitle, nameSource: "title" };
  if (parsed.firstPrompt)
    return { name: truncate(parsed.firstPrompt, 60), nameSource: "prompt" };
  return { name: id.slice(0, 8), nameSource: "id" };
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

  // Tally live (busy) sessions per project.
  const runningByProject: Record<string, number> = {};
  for (const sid of runningSet) {
    const found = findSessionFile(sid);
    if (found) {
      runningByProject[found.projectId] =
        (runningByProject[found.projectId] ?? 0) + 1;
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

  const projects: Project[] = [];
  for (const id of safeReadDir(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, id);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const files = jsonlFilesIn(dir);
    if (files.length === 0) continue;

    let lastMs = 0;
    let newestFile = files[0];
    for (const f of files) {
      const m = statMtime(path.join(dir, f));
      if (m > lastMs) {
        lastMs = m;
        newestFile = f;
      }
    }

    const cwd = firstCwd(path.join(dir, newestFile)) ?? decodeProjectId(id);

    projects.push({
      id,
      path: cwd,
      name: path.basename(cwd) || cwd,
      sessionCount: files.length,
      lastActivity: lastMs ? new Date(lastMs).toISOString() : null,
      attentionCount: attentionByProject[id] ?? 0,
      runningCount: runningByProject[id] ?? 0,
      pendingApprovalCount: pendingApprovalByProject[id] ?? 0,
    });
  }
  projects.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
  return projects;
}

export function getProject(projectId: string): Project | null {
  return getProjects().find((p) => p.id === projectId) ?? null;
}

/** Best-effort decode of an encoded project dir name (lossy: spaces became "-"). */
function decodeProjectId(id: string): string {
  return id.replace(/-/g, "/");
}

export function getSessions(projectId: string): SessionSummary[] {
  const dir = path.join(PROJECTS_DIR, projectId);
  const files = jsonlFilesIn(dir);
  if (files.length === 0) return [];

  const customNames = loadCustomNames();
  const jobNames = loadJobNames();
  const running = loadRunningSessions();
  const attention = getAttention();
  const statuses = getStatuses();
  const pendingApprovals = new Set(pendingApprovalSessionIds());

  const sessions: SessionSummary[] = files.map((f) => {
    const id = f.replace(/\.jsonl$/, "");
    const parsed = parseSession(path.join(dir, f));
    const { name, nameSource } = resolveName(id, parsed, customNames, jobNames);
    return {
      id,
      projectId,
      name,
      nameSource,
      aiTitle: parsed.aiTitle,
      customName: customNames[id] ?? null,
      firstPrompt: parsed.firstPrompt ? truncate(parsed.firstPrompt) : null,
      lastPrompt: parsed.lastPrompt ? truncate(parsed.lastPrompt) : null,
      messageCount: parsed.messageCount,
      cwd: parsed.cwd,
      gitBranch: parsed.gitBranch,
      lastActivity: parsed.lastActivity ?? new Date(statMtime(path.join(dir, f))).toISOString(),
      createdAt: parsed.createdAt,
      running: running.has(id),
      attention: running.has(id) ? null : (attention[id] ?? null),
      status: statuses[id] ?? null,
      approvalMode: getApprovalMode(id),
      pendingApproval: pendingApprovals.has(id),
    };
  });

  sessions.sort((a, b) =>
    (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
  );
  return sessions;
}

/** Locate the jsonl file + projectId for a given sessionId across all projects. */
function findSessionFile(
  sessionId: string,
): { projectId: string; file: string } | null {
  for (const projectId of safeReadDir(PROJECTS_DIR)) {
    const file = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return { projectId, file };
  }
  return null;
}

export function getSession(sessionId: string): SessionDetail | null {
  const found = findSessionFile(sessionId);
  if (!found) return null;

  const customNames = loadCustomNames();
  const jobNames = loadJobNames();
  const running = loadRunningSessions();

  const parsed = parseSession(found.file);
  const { name, nameSource } = resolveName(sessionId, parsed, customNames, jobNames);

  return {
    id: sessionId,
    projectId: found.projectId,
    name,
    nameSource,
    aiTitle: parsed.aiTitle,
    customName: customNames[sessionId] ?? null,
    firstPrompt: parsed.firstPrompt ? truncate(parsed.firstPrompt) : null,
    lastPrompt: parsed.lastPrompt ? truncate(parsed.lastPrompt) : null,
    messageCount: parsed.messageCount,
    cwd: parsed.cwd,
    gitBranch: parsed.gitBranch,
    lastActivity: parsed.lastActivity,
    createdAt: parsed.createdAt,
    running: running.has(sessionId),
    attention: running.has(sessionId) ? null : getAttentionFor(sessionId),
    status: getStatusFor(sessionId),
    approvalMode: getApprovalMode(sessionId),
    pendingApproval: new Set(pendingApprovalSessionIds()).has(sessionId),
    model: parsed.model,
    version: parsed.version,
    lastUser: parsed.lastUser,
    lastAssistant: parsed.lastAssistant,
    recap: parsed.recap,
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
