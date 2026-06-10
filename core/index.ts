import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Device-portable read layer for Claude Code's data dir (`~/.claude`).
 *
 * This is everything the dashboard knows how to read that is NOT hub-specific:
 * no sidecar names/status/attention/approvals — those live in `lib/` and only
 * exist on the hub machine. This module runs in two places:
 *  - in-process in the Next.js hub (the "local device"), and
 *  - inside `agent/index.ts` on remote devices (the other Mac / Windows box),
 * so it must stay dependency-free and platform-neutral (path.join everywhere,
 * homedir() works on Windows too).
 */

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HOME = os.homedir();
export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
export const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
export const JOBS_DIR = path.join(CLAUDE_DIR, "jobs");
export const SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoreProject {
  /** Encoded directory name, e.g. "-Users-masongill-Claude-Hub". URL-safe id. */
  id: string;
  /** Best-effort real working directory, e.g. "/Users/masongill/Claude Hub". */
  path: string;
  /** Friendly label = last segment of the path. */
  name: string;
  sessionCount: number;
  /** ISO timestamp of the most recent session activity. */
  lastActivity: string | null;
  /** Number of sessions in this project with a live (busy) process. */
  runningCount: number;
}

/** Name resolution without the hub's custom-name sidecar (that layer is hub-only). */
export type CoreNameSource = "job" | "title" | "prompt" | "id";

export interface CoreSession {
  id: string;
  projectId: string;
  /** Resolved display name (job name > ai-title > first prompt > id). */
  name: string;
  nameSource: CoreNameSource;
  /** Auto-generated AI title, if any. */
  aiTitle: string | null;
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

export interface CoreSessionDetail extends CoreSession {
  model: string | null;
  version: string | null;
  lastUser: Interaction | null;
  lastAssistant: Interaction | null;
  /** Most recent away recap, if Claude Code generated one. */
  recap: Recap | null;
}

/** Callers that track extra live sessions (e.g. the hub's SDK daemon) pass the
 *  full running set; otherwise it's computed from the CLI's sessions dir. */
export interface ListOptions {
  runningIds?: Set<string>;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

export function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Parse a JSONL file into an array of entries, skipping malformed lines. */
export function readJsonl(file: string): any[] {
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
export function extractText(content: unknown): string {
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
export function extractTools(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b && b.type === "tool_use" && typeof b.name === "string")
    .map((b) => b.name as string);
}

export function truncate(s: string, n = 280): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

export function statMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
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
export function loadJobNames(): Map<string, string> {
  const map = new Map<string, string>();
  for (const short of safeReadDir(JOBS_DIR)) {
    const state = readJson<JobInfo>(path.join(JOBS_DIR, short, "state.json"));
    if (state?.sessionId && state.name && state.nameSource === "user") {
      map.set(state.sessionId, state.name);
    }
  }
  return map;
}

/** Set of sessionIds with a live, busy CLI process (`~/.claude/sessions/*.json`). */
export function loadCliRunningSessions(): Set<string> {
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

export function jsonlFilesIn(projectDir: string): string[] {
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

export interface ParsedSession {
  aiTitle: string | null;
  /** Native display name set via `claude -n` or `/rename` (persisted in the JSONL). */
  customTitle: string | null;
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

export function parseSession(file: string): ParsedSession {
  const entries = readJsonl(file);
  const res: ParsedSession = {
    aiTitle: null,
    customTitle: null,
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
      case "custom-title":
        // Native name from `claude -n <name>` or `/rename`. Latest wins.
        if (typeof e.customTitle === "string") res.customTitle = e.customTitle;
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
export function firstCwd(file: string): string | null {
  const entries = readJsonl(file);
  for (const e of entries) {
    if (typeof e.cwd === "string") return e.cwd;
  }
  return null;
}

/** Best-effort decode of an encoded project dir name (lossy: spaces became "-"). */
export function decodeProjectId(id: string): string {
  return id.replace(/-/g, "/");
}

/** Locate the jsonl file + projectId for a given sessionId across all projects. */
export function findSessionFile(
  sessionId: string,
): { projectId: string; file: string } | null {
  for (const projectId of safeReadDir(PROJECTS_DIR)) {
    const file = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return { projectId, file };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Name resolution (sans hub custom names — the hub overlays those itself)
// ---------------------------------------------------------------------------

function resolveBaseName(
  id: string,
  parsed: {
    aiTitle: string | null;
    customTitle: string | null;
    firstPrompt: string | null;
  },
  jobNames: Map<string, string>,
): { name: string; nameSource: CoreNameSource } {
  const job = jobNames.get(id);
  if (job) return { name: job, nameSource: "job" };
  // Native name from `claude -n` / `/rename` (interactive sessions, no job entry).
  if (parsed.customTitle) return { name: parsed.customTitle, nameSource: "job" };
  if (parsed.aiTitle) return { name: parsed.aiTitle, nameSource: "title" };
  if (parsed.firstPrompt)
    return { name: truncate(parsed.firstPrompt, 60), nameSource: "prompt" };
  return { name: id.slice(0, 8), nameSource: "id" };
}

// ---------------------------------------------------------------------------
// Public listing API
// ---------------------------------------------------------------------------

export function listProjects(opts: ListOptions = {}): CoreProject[] {
  const runningSet = opts.runningIds ?? loadCliRunningSessions();

  // Tally live (busy) sessions per project.
  const runningByProject: Record<string, number> = {};
  for (const sid of runningSet) {
    const found = findSessionFile(sid);
    if (found) {
      runningByProject[found.projectId] =
        (runningByProject[found.projectId] ?? 0) + 1;
    }
  }

  const projects: CoreProject[] = [];
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
      runningCount: runningByProject[id] ?? 0,
    });
  }
  projects.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
  return projects;
}

export function listSessions(projectId: string, opts: ListOptions = {}): CoreSession[] {
  const dir = path.join(PROJECTS_DIR, projectId);
  const files = jsonlFilesIn(dir);
  if (files.length === 0) return [];

  const jobNames = loadJobNames();
  const running = opts.runningIds ?? loadCliRunningSessions();

  const sessions: CoreSession[] = files.map((f) => {
    const id = f.replace(/\.jsonl$/, "");
    const parsed = parseSession(path.join(dir, f));
    const { name, nameSource } = resolveBaseName(id, parsed, jobNames);
    return {
      id,
      projectId,
      name,
      nameSource,
      aiTitle: parsed.aiTitle,
      firstPrompt: parsed.firstPrompt ? truncate(parsed.firstPrompt) : null,
      lastPrompt: parsed.lastPrompt ? truncate(parsed.lastPrompt) : null,
      messageCount: parsed.messageCount,
      cwd: parsed.cwd,
      gitBranch: parsed.gitBranch,
      lastActivity:
        parsed.lastActivity ?? new Date(statMtime(path.join(dir, f))).toISOString(),
      createdAt: parsed.createdAt,
      running: running.has(id),
    };
  });

  sessions.sort((a, b) =>
    (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
  );
  return sessions;
}

export function getSessionDetail(
  sessionId: string,
  opts: ListOptions = {},
): CoreSessionDetail | null {
  const found = findSessionFile(sessionId);
  if (!found) return null;

  const jobNames = loadJobNames();
  const running = opts.runningIds ?? loadCliRunningSessions();

  const parsed = parseSession(found.file);
  const { name, nameSource } = resolveBaseName(sessionId, parsed, jobNames);

  return {
    id: sessionId,
    projectId: found.projectId,
    name,
    nameSource,
    aiTitle: parsed.aiTitle,
    firstPrompt: parsed.firstPrompt ? truncate(parsed.firstPrompt) : null,
    lastPrompt: parsed.lastPrompt ? truncate(parsed.lastPrompt) : null,
    messageCount: parsed.messageCount,
    cwd: parsed.cwd,
    gitBranch: parsed.gitBranch,
    lastActivity: parsed.lastActivity,
    createdAt: parsed.createdAt,
    running: running.has(sessionId),
    model: parsed.model,
    version: parsed.version,
    lastUser: parsed.lastUser,
    lastAssistant: parsed.lastAssistant,
    recap: parsed.recap,
  };
}

/** Absolute path of a session's transcript JSONL, if it exists. */
export function getTranscriptPath(sessionId: string): string | null {
  return findSessionFile(sessionId)?.file ?? null;
}
