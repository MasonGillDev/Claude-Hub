/**
 * Claude Hub session daemon.
 *
 * The single long-running process that owns live Claude Agent SDK sessions.
 * Next.js stays stateless: it proxies session control here and otherwise just
 * reads ~/.claude transcripts + ~/.claude-hub sidecars off disk.
 *
 * Each session is a streaming-input `query()`: we push user turns into a live
 * input queue (multi-turn chat) and fan the model's output messages out to SSE
 * subscribers (the chat dialog). Tool-call approvals flow through the SAME file
 * store the PreToolUse hook uses (lib/approvals.ts) — canUseTool writes a pending
 * Approval and reads the decision back; no Next<->daemon IPC for approvals.
 *
 * Run: `npm run daemon` (tsx). Listens on 127.0.0.1:3001.
 */
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  query,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  createApproval,
  getApproval,
  deleteApproval,
  getApprovalMode,
  setApprovalMode,
} from "../lib/approvals";
import { setAttention } from "../lib/attention";
import {
  publishDaemonSession,
  unpublishDaemonSession,
  touchDaemonHeartbeat,
} from "../lib/daemonLive";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_HUB_DAEMON_PORT ?? 3001);

/** How often canUseTool re-reads the shared store while awaiting a decision. */
const POLL_MS = 300;

type SessionStatus = "running" | "done" | "error";

/**
 * A single-consumer pushable async-iterable of user turns. The SDK `query()`
 * consumes this as its streaming input; `push()` feeds a new turn at any time,
 * `close()` ends the session (the query finishes after the current turn).
 */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private queued: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(text: string): void {
    if (this.closed) return;
    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: msg, done: false });
    } else {
      this.queued.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queued.length) {
          return Promise.resolve({ value: this.queued.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

interface LiveSession {
  id: string;
  cwd: string;
  prompt: string;
  startedAt: string;
  status: SessionStatus;
  error?: string;
  /** Model is mid-turn (input received, no result yet). */
  busy: boolean;
  query: Query;
  input: InputQueue;
  /** SSE subscribers (the open chat dialogs). */
  subscribers: Set<http.ServerResponse>;
  /** Pre-serialized SSE frames, replayed to a client when it connects. */
  buffer: string[];
  seq: number;
}

const sessions = new Map<string, LiveSession>();

/** Push a normalized event to every subscriber and the replay buffer. */
function broadcast(s: LiveSession, event: unknown): void {
  s.seq += 1;
  const frame = `id: ${s.seq}\ndata: ${JSON.stringify(event)}\n\n`;
  s.buffer.push(frame);
  if (s.buffer.length > 5000) s.buffer.shift();
  for (const res of s.subscribers) {
    try {
      res.write(frame);
    } catch {
      /* dropped client; cleaned up on 'close' */
    }
  }
}

function setBusy(s: LiveSession, busy: boolean): void {
  if (s.busy === busy) return;
  s.busy = busy;
  // Mirror to the sidecar so the dashboard shows the "running" badge live.
  publishDaemonSession(s.id, s.cwd, busy);
  broadcast(s, { kind: "status", busy, status: s.status });
}

// --- approvals (unchanged path through the shared file store) ----------------

function makeCanUseTool(sessionId: string, cwd: string) {
  return async function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    { signal, toolUseID }: { signal: AbortSignal; toolUseID: string },
  ): Promise<PermissionResult> {
    const gate = getApprovalMode(sessionId);
    console.log(`[session ${sessionId}] canUseTool tool=${toolName} gate=${gate}`);
    if (!gate) {
      return { behavior: "allow", updatedInput: input };
    }
    const id = toolUseID || randomUUID();
    createApproval({ id, sessionId, tool: toolName, input, cwd, source: "sdk" });
    // Surface the request inline in the chat stream too (not just the home panel).
    const s = sessions.get(sessionId);
    if (s) broadcast(s, { kind: "approval_request", id, tool: toolName, input });
    try {
      const r = await waitForDecision(id, input, signal);
      if (s) broadcast(s, { kind: "approval_resolved", id, decision: r.behavior });
      return r;
    } finally {
      deleteApproval(id);
    }
  };
}

/** Poll the shared store until the dashboard decides, the entry vanishes, or we abort. */
function waitForDecision(
  id: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<PermissionResult> {
  return new Promise((resolve) => {
    const tick = () => {
      if (signal.aborted) return resolve({ behavior: "deny", message: "Aborted" });
      const a = getApproval(id);
      if (!a) return resolve({ behavior: "deny", message: "Approval dismissed" });
      if (a.decision === "allow") return resolve({ behavior: "allow", updatedInput: input });
      if (a.decision === "deny") return resolve({ behavior: "deny", message: "Denied in Claude Hub" });
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

// --- session lifecycle -------------------------------------------------------

interface LaunchArgs {
  /** Existing session id to resume; omit to start a fresh session. */
  id?: string;
  resume?: boolean;
  prompt?: string;
  cwd?: string;
  model?: string;
  approvalMode?: boolean;
}

/**
 * Start a new SDK session, or (with `resume`) continue an existing one from its
 * persisted transcript — same mechanism, just `resume: id` vs `sessionId: id`.
 * Either way the daemon owns the live query and fans its output to subscribers.
 */
function launchSession({ id: givenId, resume = false, prompt, cwd, model, approvalMode }: LaunchArgs): string {
  const id = givenId ?? randomUUID();
  const sessionCwd = cwd?.trim() || os.homedir();
  if (approvalMode !== undefined) setApprovalMode(id, approvalMode);

  const input = new InputQueue();
  const hasPrompt = !!(prompt && prompt.trim());
  if (hasPrompt) input.push(prompt!); // first turn (omitted on a bare resume)

  // Build the child env WITHOUT ANTHROPIC_API_KEY so the spawned Agent SDK
  // authenticates via the logged-in Claude subscription (Keychain) instead of
  // billing the per-token API key. Without this, an unset model defaults to
  // claude-opus-4-7 charged to the key. Tool-Gate / Second-Brain call the raw
  // Messages API and still need the key — this only scopes Claude Hub's sessions.
  const childEnv: Record<string, string | undefined> = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;

  const q = query({
    prompt: input,
    options: {
      cwd: sessionCwd,
      env: childEnv,
      // Resume continues the existing transcript under the same id; a new session
      // sets its own id so transcript + approvals share it.
      ...(resume ? { resume: id } : { sessionId: id }),
      ...(model ? { model } : {}),
      // Claude Code's real system prompt so the model knows its environment (cwd,
      // git status). Without it the prompt is bare and the model invents paths.
      systemPrompt: { type: "preset", preset: "claude_code" },
      permissionMode: "default",
      // `[]` loads NO filesystem settings; omitting it loads ALL (CLI default)
      // incl. the approve-hook, which would bypass canUseTool. Transcripts persist.
      settingSources: [],
      canUseTool: makeCanUseTool(id, sessionCwd),
    },
  });

  const session: LiveSession = {
    id,
    cwd: sessionCwd,
    prompt: prompt ?? "",
    startedAt: new Date().toISOString(),
    status: "running",
    busy: hasPrompt,
    query: q,
    input,
    subscribers: new Set(),
    buffer: [],
    seq: 0,
  };
  sessions.set(id, session);
  // setBusy only fires on transitions; publish the initial state explicitly so a
  // session that starts mid-turn (with a prompt) shows "running" right away.
  publishDaemonSession(id, sessionCwd, session.busy);

  // Drain the model's output stream, fanning each message to subscribers. The
  // loop stays alive across turns until the query ends (interrupt-close / error).
  void (async () => {
    try {
      for await (const msg of q) {
        if (msg.type === "assistant") {
          setBusy(session, true);
          broadcast(session, { kind: "assistant", content: msg.message?.content ?? [] });
        } else if (msg.type === "user") {
          // Only surface tool_result user messages; our own pushed turns are
          // shown by the client optimistically and would otherwise duplicate.
          const content = msg.message?.content;
          if (Array.isArray(content) && content.some((b) => b?.type === "tool_result")) {
            broadcast(session, { kind: "tool_result", content });
          }
        } else if (msg.type === "result") {
          setBusy(session, false);
          broadcast(session, { kind: "result", subtype: (msg as { subtype?: string }).subtype });
          // Notify the dashboard the turn finished — but only if nobody's watching
          // this session's chat (subscribers all closed = you've navigated away).
          // If the chat is open you can already see it; running-suppression in the
          // events poll would clear it anyway.
          if (session.subscribers.size === 0) {
            setAttention(id, "done", null, sessionCwd);
          }
        }
      }
      session.status = "done";
    } catch (err) {
      session.status = "error";
      session.error = err instanceof Error ? err.message : String(err);
      console.error(`[session ${id}] error:`, err);
    } finally {
      session.busy = false;
      unpublishDaemonSession(id);
      broadcast(session, { kind: "end", status: session.status, error: session.error });
      for (const res of session.subscribers) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      session.subscribers.clear();
    }
  })();

  return id;
}

// --- tiny HTTP layer ---------------------------------------------------------

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sessionView(s: LiveSession) {
  return {
    id: s.id,
    cwd: s.cwd,
    prompt: s.prompt,
    startedAt: s.startedAt,
    status: s.status,
    busy: s.busy,
    ...(s.error ? { error: s.error } : {}),
  };
}

/** Open an SSE stream for a session: replay the buffer, then stream live. */
function streamSession(s: LiveSession, req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(`retry: 2000\n\n`);
  for (const frame of s.buffer) res.write(frame); // backlog
  if (s.status !== "running") {
    res.write(`data: ${JSON.stringify({ kind: "end", status: s.status, error: s.error })}\n\n`);
    res.end();
    return;
  }
  s.subscribers.add(res);
  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* ignore */
    }
  }, 15000);
  req.on("close", () => {
    clearInterval(ping);
    s.subscribers.delete(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/health") {
      return send(res, 200, { ok: true, sessions: sessions.size });
    }

    if (method === "GET" && path === "/sessions") {
      return send(res, 200, { sessions: [...sessions.values()].map(sessionView) });
    }

    if (method === "POST" && path === "/sessions") {
      const body = await readJson(req);
      if (typeof body.prompt !== "string" || !body.prompt.trim()) {
        return send(res, 400, { error: "'prompt' (non-empty string) is required" });
      }
      const cwd = typeof body.cwd === "string" ? body.cwd : undefined;
      if (cwd && !fs.existsSync(cwd)) {
        return send(res, 400, { error: `cwd does not exist: ${cwd}` });
      }
      const id = launchSession({
        prompt: body.prompt,
        cwd,
        model: typeof body.model === "string" ? body.model : undefined,
        approvalMode: body.approvalMode !== false,
      });
      return send(res, 201, { id });
    }

    // /sessions/:id/(input|stream|stop|resume)
    const m = path.match(/^\/sessions\/([^/]+)\/(input|stream|stop|resume)$/);
    if (m) {
      const sid = m[1];

      // Resume targets a session that's typically NOT live in the daemon, so it
      // runs before the existence check. Idempotent if already live.
      if (method === "POST" && m[2] === "resume") {
        const existing = sessions.get(sid);
        if (existing && existing.status === "running") {
          return send(res, 200, { id: sid, alreadyLive: true });
        }
        const body = await readJson(req);
        const cwd = typeof body.cwd === "string" ? body.cwd : existing?.cwd;
        if (cwd && !fs.existsSync(cwd)) {
          return send(res, 400, { error: `cwd does not exist: ${cwd}` });
        }
        launchSession({
          id: sid,
          resume: true,
          prompt: typeof body.text === "string" ? body.text : undefined,
          cwd,
          // undefined => preserve the session's existing approval toggle
          approvalMode: typeof body.approvalMode === "boolean" ? body.approvalMode : undefined,
        });
        return send(res, 200, { id: sid, resumed: true });
      }

      const s = sessions.get(sid);
      if (!s) return send(res, 404, { error: "session not found" });

      if (method === "GET" && m[2] === "stream") {
        return streamSession(s, req, res);
      }
      if (method === "POST" && m[2] === "input") {
        if (s.status !== "running") return send(res, 409, { error: `session is ${s.status}` });
        const body = await readJson(req);
        if (typeof body.text !== "string" || !body.text.trim()) {
          return send(res, 400, { error: "'text' (non-empty string) is required" });
        }
        s.input.push(body.text);
        setBusy(s, true);
        return send(res, 202, { ok: true });
      }
      if (method === "POST" && m[2] === "stop") {
        // Interrupt the CURRENT turn only — the session stays live so you can keep
        // chatting. (A session ends on daemon restart or error, and `resume` brings
        // it back from the transcript.)
        try {
          await s.query.interrupt();
        } catch {
          /* may already be idle */
        }
        setBusy(s, false);
        return send(res, 200, { ok: true });
      }
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.log(`port ${PORT} already in use — another daemon is running; exiting.`);
    process.exit(0);
  }
  console.error("daemon server error:", err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`claude-hub session daemon on http://${HOST}:${PORT}`);
});

// Keep the daemon-live sidecar's heartbeat fresh while sessions exist, so a long
// model turn never looks stale to the dashboard. If the daemon dies, the heartbeat
// stops and `loadDaemonRunning()` drops every entry after DAEMON_STALE_MS.
const heartbeat = setInterval(touchDaemonHeartbeat, 10_000);
heartbeat.unref();
