"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";

type Conn = "connecting" | "live" | "ended" | "notlive";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  content?: unknown;
}

interface ChatItem {
  key: string;
  role: "user" | "assistant" | "tool" | "approval";
  text?: string;
  tools?: string[];
  // approval-only
  approvalId?: string;
  toolName?: string;
  detail?: string;
  resolved?: "allow" | "deny" | null;
}

let counter = 0;
const nextKey = () => `c${++counter}`;

function blocksToText(blocks: ContentBlock[]): string {
  return (blocks || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}
function blockTools(blocks: ContentBlock[]): string[] {
  return (blocks || []).filter((b) => b.type === "tool_use").map((b) => b.name || "tool");
}
function toolResultText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks || []) {
    if (b.type !== "tool_result") continue;
    const c = b.content;
    if (typeof c === "string") parts.push(c);
    else if (Array.isArray(c)) {
      for (const inner of c as ContentBlock[]) {
        if (inner?.type === "text" && typeof inner.text === "string") parts.push(inner.text);
      }
    }
  }
  return parts.join("\n");
}

/** Human-readable text of a tool call's input, for the approval card. */
function inputDetail(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  if (typeof input.command === "string") return input.command;
  const parts: string[] = [];
  if (typeof input.file_path === "string") parts.push(input.file_path);
  else if (typeof input.path === "string") parts.push(input.path);
  if (typeof input.old_string === "string") parts.push("--- remove ---\n" + input.old_string);
  if (typeof input.new_string === "string") parts.push("--- add ---\n" + input.new_string);
  if (typeof input.content === "string") parts.push(input.content);
  if (parts.length) return parts.join("\n\n");
  return JSON.stringify(input, null, 2);
}

export function SessionChat({ sessionId, running = false }: { sessionId: string; running?: boolean }) {
  const [conn, setConn] = useState<Conn>("connecting");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reconnect, setReconnect] = useState(0);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A session live in a terminal is single-writer — never open a stream / co-drive it.
    if (running) return;
    const ctrl = new AbortController();
    let cancelled = false;

    function handle(ev: {
      kind: string;
      content?: ContentBlock[];
      busy?: boolean;
      status?: string;
      id?: string;
      tool?: string;
      input?: Record<string, unknown>;
      decision?: "allow" | "deny";
    }) {
      if (ev.kind === "assistant") {
        const text = blocksToText(ev.content || []);
        const tools = blockTools(ev.content || []);
        if (text || tools.length) {
          setItems((cur) => [...cur, { key: nextKey(), role: "assistant", text, tools }]);
        }
      } else if (ev.kind === "tool_result") {
        const text = toolResultText(ev.content || []);
        if (text.trim()) setItems((cur) => [...cur, { key: nextKey(), role: "tool", text }]);
      } else if (ev.kind === "approval_request") {
        setItems((cur) => [
          ...cur,
          {
            key: nextKey(),
            role: "approval",
            approvalId: ev.id,
            toolName: ev.tool,
            detail: inputDetail(ev.input),
            resolved: null,
          },
        ]);
      } else if (ev.kind === "approval_resolved") {
        setItems((cur) =>
          cur.map((it) =>
            it.role === "approval" && it.approvalId === ev.id ? { ...it, resolved: ev.decision ?? null } : it,
          ),
        );
      } else if (ev.kind === "status") {
        setBusy(!!ev.busy);
      } else if (ev.kind === "result") {
        setBusy(false);
      } else if (ev.kind === "end") {
        setBusy(false);
        setConn("ended");
      }
    }

    (async () => {
      let res: Response;
      try {
        res = await fetch(`/api/sdk/sessions/${sessionId}/stream`, { signal: ctrl.signal });
      } catch {
        if (!cancelled) setConn("notlive");
        return;
      }
      if (!res.ok || !res.body) {
        if (!cancelled) setConn("notlive");
        return;
      }
      if (!cancelled) setConn("live");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (line) handle(JSON.parse(line.slice(5).trim()));
          }
        }
      } catch {
        /* aborted or stream ended */
      }
      if (!cancelled) setConn((c) => (c === "live" ? "ended" : c));
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [sessionId, reconnect, running]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, busy]);

  async function decide(approvalId: string, decision: "allow" | "deny") {
    setItems((cur) =>
      cur.map((it) => (it.approvalId === approvalId ? { ...it, resolved: decision } : it)),
    );
    await fetch(`/api/approvals/${approvalId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }).catch(() => {});
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending || busy || conn !== "live") return;
    setSending(true);
    setItems((cur) => [...cur, { key: nextKey(), role: "user", text }]);
    setDraft("");
    setBusy(true);
    try {
      await fetch(`/api/sdk/sessions/${sessionId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch {
      /* surfaced via stream */
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    await fetch(`/api/sdk/sessions/${sessionId}/stop`, { method: "POST" }).catch(() => {});
  }

  async function resume() {
    setResuming(true);
    setResumeError(null);
    try {
      const r = await fetch(`/api/sdk/sessions/${sessionId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (r.ok) {
        setItems([]);
        setConn("connecting");
        setReconnect((n) => n + 1);
      } else {
        const data = await r.json().catch(() => ({}));
        setResumeError(
          (data as { error?: string }).error || `Resume failed (HTTP ${r.status})`,
        );
      }
    } catch {
      setResumeError("Couldn't reach the server.");
    } finally {
      setResuming(false);
    }
  }

  // A session live in a terminal is single-writer: we can't safely drive it from
  // here too. Show a message rather than the console (let it go idle + close the
  // terminal, then refresh). `running` is the page-load snapshot, hence the hint.
  if (running) return <TerminalActiveNotice />;

  if (conn === "connecting") return null;

  if (conn === "notlive") {
    // Not driven by the daemon and not running in a terminal: continue it from the
    // saved transcript — works for a stopped in-app session OR an idle terminal one.
    return (
      <section className="mt-6 rounded-3xl border border-indigo-200 glass p-4 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold">Continue this session here</span>
            <p className="mt-0.5 text-xs text-ink-soft">
              Picks up from the saved transcript — works for in-app or terminal sessions, as long as
              it isn&apos;t running in a terminal right now.
            </p>
          </div>
          <button
            onClick={resume}
            disabled={resuming}
            className="shrink-0 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-soft hover:from-indigo-600 hover:to-violet-600 disabled:opacity-60"
          >
            {resuming ? "Resuming…" : "Resume"}
          </button>
        </div>
        {resumeError && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{resumeError}</p>
        )}
      </section>
    );
  }

  const ended = conn === "ended";
  const awaitingApproval = items.some((it) => it.role === "approval" && !it.resolved);

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-indigo-200 glass shadow-soft">
      <div className="flex items-center gap-2 border-b border-white/60 px-4 py-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-[11px] font-bold text-white">
          ✦
        </span>
        <span className="text-sm font-semibold">In-app session</span>
        <span
          className={`ml-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            ended ? "bg-ink/10 text-ink-faint" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${ended ? "bg-ink/30" : "bg-emerald-500"}`} />
          {ended ? "ended" : "live"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!ended && busy && (
            <button
              onClick={stop}
              className="rounded-full border border-rose-200 px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
            >
              Stop
            </button>
          )}
          {ended && !running && (
            <button
              onClick={resume}
              disabled={resuming}
              className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-1 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-600 disabled:opacity-60"
            >
              {resuming ? "Resuming…" : "Resume"}
            </button>
          )}
        </div>
      </div>

      {resumeError && (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">
          {resumeError}
        </div>
      )}

      <div ref={scrollRef} className="max-h-[32rem] space-y-3 overflow-auto px-4 py-4">
        {items.length === 0 && <p className="py-6 text-center text-sm text-ink-faint">Starting…</p>}
        {items.map((it) => (
          <ChatBubble key={it.key} item={it} onDecide={decide} />
        ))}
        {busy && !awaitingApproval && (
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
            Claude is working…
          </div>
        )}
      </div>

      <div className="border-t border-white/60 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            disabled={ended}
            placeholder={ended ? "Session ended." : "Reply… (Enter to send, Shift+Enter for newline)"}
            className="min-h-[2.5rem] flex-1 resize-y rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm outline-none ring-indigo-300 focus:ring-2 disabled:bg-ink/5"
          />
          <button
            onClick={send}
            disabled={ended || sending || busy || !draft.trim()}
            className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2 text-sm font-medium text-white shadow-soft hover:from-indigo-600 hover:to-violet-600 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}

/** Shown when the session is live in a terminal — interacting here would mean two
 *  writers on one session, so we point the user at freeing it up first. */
function TerminalActiveNotice() {
  return (
    <section className="mt-6 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50/90 to-orange-50/70 p-5 shadow-soft">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <span aria-hidden>⌨️</span>
        This session is active in a terminal
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-amber-800/90">
        To avoid two writers on the same session, the in-app console stays closed while it&apos;s
        running in a terminal. Let the agent go idle and close that terminal, then refresh this
        page to continue here.
      </p>
    </section>
  );
}

function ChatBubble({
  item,
  onDecide,
}: {
  item: ChatItem;
  onDecide: (id: string, d: "allow" | "deny") => void;
}) {
  if (item.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-500 px-3.5 py-2 text-sm text-white shadow-soft">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.role === "tool") {
    return (
      <details className="rounded-xl border border-white/60 bg-ink/5 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-mono text-ink-faint">↳ tool result</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-ink-soft">
          {item.text}
        </pre>
      </details>
    );
  }

  if (item.role === "approval") {
    const resolved = item.resolved;
    return (
      <div className="rounded-2xl border border-indigo-300 bg-indigo-50/70 p-3 shadow-soft">
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-800">
          <span aria-hidden>🛡</span>
          Approve <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-mono text-xs">{item.toolName}</span>?
        </div>
        {item.detail && (
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 px-3 py-2 font-mono text-xs text-ink-soft">
            {item.detail}
          </pre>
        )}
        {resolved ? (
          <div
            className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              resolved === "allow" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
            }`}
          >
            {resolved === "allow" ? "✓ Allowed" : "✕ Denied"}
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => item.approvalId && onDecide(item.approvalId, "allow")}
              className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
            >
              Allow
            </button>
            <button
              onClick={() => item.approvalId && onDecide(item.approvalId, "deny")}
              className="rounded-full bg-rose-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-600"
            >
              Deny
            </button>
          </div>
        )}
      </div>
    );
  }

  // assistant
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl border border-white/70 bg-white/80 px-3.5 py-2 text-ink shadow-soft">
        {item.text && <Markdown>{item.text}</Markdown>}
        {item.tools && item.tools.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.tools.map((t, i) => (
              <span
                key={i}
                className="rounded-full bg-indigo-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-700"
              >
                ⚙ {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
