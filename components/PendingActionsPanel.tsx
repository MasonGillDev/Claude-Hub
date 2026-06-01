"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TimeAgo } from "@/components/TimeAgo";

interface Approval {
  id: string;
  sessionId: string;
  tool: string;
  input: Record<string, unknown>;
  cwd: string | null;
  createdAt: string;
  source?: "hook" | "sdk";
}

function basename(p: string | null): string {
  if (!p) return "session";
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

/** Full, human-readable text of a tool call's input (shown when expanded). */
function fullDetail(input: Record<string, unknown>): string {
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

export function PendingActionsPanel() {
  const router = useRouter();
  const [items, setItems] = useState<Approval[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const sig = useRef("");

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/approvals", { cache: "no-store" });
        const data = await res.json();
        const list: Approval[] = data.approvals ?? [];
        if (!alive) return;
        const newSig = list.map((a) => a.id).join("|");
        if (newSig !== sig.current) {
          sig.current = newSig;
          setItems(list);
          router.refresh(); // keep project/session card pulses in sync
        }
      } catch {
        // best-effort
      }
    }
    poll();
    const t = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [router]);

  const toggle = useCallback((id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function decide(id: string, decision: "allow" | "deny") {
    setBusy(id);
    setItems((cur) => cur.filter((a) => a.id !== id));
    try {
      await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const count = items.length;

  return (
    <section className="mt-12">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
          Pending actions
        </h2>
        {count > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-indigo-500 px-1.5 text-[11px] font-bold text-white">
            {count}
          </span>
        )}
      </div>

      {count === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/70 bg-white/50 px-5 py-8 text-center text-sm text-ink-faint">
          Nothing waiting for your approval.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => {
            const open = expanded.has(a.id);
            const detail = fullDetail(a.input);
            return (
              <li
                key={a.id}
                className="w-full overflow-hidden rounded-2xl border border-indigo-200 glass shadow-soft"
              >
                <div className="flex items-start gap-3 p-4">
                  <button
                    onClick={() => toggle(a.id)}
                    className="flex min-w-0 flex-1 flex-col text-left"
                    aria-expanded={open}
                  >
                    <div className="flex items-center gap-2 text-xs text-ink-faint">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700">
                        {a.tool}
                      </span>
                      <span className="truncate font-mono">{basename(a.cwd)}</span>
                      {a.source === "sdk" && (
                        <span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-medium text-violet-700">
                          in-app
                        </span>
                      )}
                      <span className="ml-auto whitespace-nowrap">
                        <TimeAgo iso={a.createdAt} />
                      </span>
                    </div>
                    {detail && (
                      <pre
                        className={`mt-2 w-full whitespace-pre-wrap break-words rounded-lg bg-ink/5 px-3 py-2 font-mono text-xs text-ink-soft ${
                          open ? "max-h-96 overflow-auto" : "clamp-2"
                        }`}
                      >
                        {detail}
                      </pre>
                    )}
                    {detail && !open && detail.length > 80 && (
                      <span className="mt-1 text-[11px] font-medium text-indigo-600">
                        Show more
                      </span>
                    )}
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => decide(a.id, "allow")}
                      disabled={busy === a.id}
                      className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
                    >
                      Allow
                    </button>
                    <button
                      onClick={() => decide(a.id, "deny")}
                      disabled={busy === a.id}
                      className="rounded-full bg-rose-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
