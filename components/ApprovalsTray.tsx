"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Approval {
  id: string;
  sessionId: string;
  tool: string;
  input: Record<string, unknown>;
  cwd: string | null;
  createdAt: string;
}

function basename(p: string | null): string {
  if (!p) return "session";
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

function detailOf(a: Approval): string {
  const i = a.input || {};
  return (
    (i.command as string) ||
    (i.file_path as string) ||
    (i.path as string) ||
    ""
  );
}

export function ApprovalsTray() {
  const router = useRouter();
  const [items, setItems] = useState<Approval[]>([]);
  const [open, setOpen] = useState(false);
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
          setOpen(list.length > 0 ? true : false);
          router.refresh();
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
  if (count === 0 && !open) {
    // Hide entirely when there's nothing to approve.
    return null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative grid h-10 w-10 place-items-center rounded-2xl border text-white shadow-soft transition ${
          count > 0
            ? "animate-pulse-ring-indigo border-indigo-300 bg-gradient-to-br from-indigo-500 to-violet-500"
            : "border-white/60 glass text-ink-soft"
        }`}
        aria-label={`${count} tool call${count === 1 ? "" : "s"} awaiting approval`}
        title="Tool calls awaiting approval"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-indigo-600 shadow">
            {count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-96 overflow-hidden rounded-2xl border border-white/70 glass shadow-lift">
            <div className="border-b border-white/60 px-4 py-2.5 text-sm font-semibold">
              Awaiting approval {count > 0 && `(${count})`}
            </div>
            {count === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-ink-faint">
                Nothing waiting.
              </div>
            ) : (
              <ul className="max-h-[26rem] overflow-auto">
                {items.map((a) => (
                  <li key={a.id} className="border-b border-white/50 px-4 py-3 last:border-0">
                    <div className="flex items-center gap-2 text-xs text-ink-faint">
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700">
                        {a.tool}
                      </span>
                      <span className="truncate">{basename(a.cwd)}</span>
                    </div>
                    {detailOf(a) && (
                      <pre className="clamp-3 mt-1.5 whitespace-pre-wrap break-all rounded-lg bg-ink/5 px-2.5 py-1.5 font-mono text-xs text-ink-soft">
                        {detailOf(a)}
                      </pre>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => decide(a.id, "allow")}
                        disabled={busy === a.id}
                        className="flex-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
                      >
                        Allow
                      </button>
                      <button
                        onClick={() => decide(a.id, "deny")}
                        disabled={busy === a.id}
                        className="flex-1 rounded-full bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
                      >
                        Deny
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-white/60 px-4 py-2 text-[11px] text-ink-faint">
              No answer in 20s → falls back to the terminal prompt.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
