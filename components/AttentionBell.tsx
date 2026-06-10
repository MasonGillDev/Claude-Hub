"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { relativeTime } from "@/lib/format";

interface Entry {
  event: "done" | "needs_input" | "subagent_done";
  message: string | null;
  at: string;
  cwd: string | null;
  /** Set when the session lives on a remote device (links to its device page). */
  deviceId?: string | null;
}

const META: Record<Entry["event"], { label: string; dot: string }> = {
  done: { label: "Finished — your turn", dot: "bg-amber-500" },
  needs_input: { label: "Needs your input", dot: "bg-rose-500" },
  subagent_done: { label: "Subagent finished", dot: "bg-violet-500" },
};

function basename(p: string | null): string {
  if (!p) return "session";
  // Handles both / and \ — remote cwds may come from Windows.
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function AttentionBell() {
  const router = useRouter();
  const [items, setItems] = useState<[string, Entry][]>([]);
  const [open, setOpen] = useState(false);
  const sig = useRef("");

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/events", { cache: "no-store" });
        const data = await res.json();
        const map: Record<string, Entry> = data.attention ?? {};
        const running: string[] = data.running ?? [];
        const entries = Object.entries(map).sort((a, b) =>
          (b[1].at ?? "").localeCompare(a[1].at ?? ""),
        );
        if (!alive) return;
        const newSig =
          entries.map(([id, e]) => `${id}:${e.at}`).join("|") +
          "#" +
          [...running].sort().join(",");
        if (newSig !== sig.current) {
          sig.current = newSig;
          setItems(entries);
          // refresh server components so cards/rows pulse in sync
          router.refresh();
        }
      } catch {
        // dashboard polling is best-effort
      }
    }
    poll();
    const t = setInterval(poll, 1500);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  const count = items.length;

  async function dismissAll() {
    setItems([]);
    sig.current = "";
    try {
      await fetch("/api/events", { method: "DELETE" });
    } catch {
      // best-effort
    }
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative grid h-10 w-10 place-items-center rounded-2xl border border-white/60 glass text-ink-soft transition hover:text-ink ${
          count > 0 ? "animate-pulse-ring text-amber-600" : ""
        }`}
        aria-label={`${count} session${count === 1 ? "" : "s"} need attention`}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-white/70 glass shadow-lift">
            <div className="flex items-center justify-between gap-2 border-b border-white/60 px-4 py-2.5">
              <span className="text-sm font-semibold">
                Needs attention {count > 0 && `(${count})`}
              </span>
              {count > 0 && (
                <button
                  onClick={dismissAll}
                  className="rounded-full px-2 py-0.5 text-xs font-medium text-ink-faint transition hover:bg-rose-50 hover:text-rose-600"
                >
                  Dismiss all
                </button>
              )}
            </div>
            {count === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-ink-faint">
                All caught up.
              </div>
            ) : (
              <ul className="max-h-96 overflow-auto">
                {items.map(([id, e]) => (
                  <li key={id}>
                    <Link
                      href={
                        e.deviceId
                          ? `/devices/${encodeURIComponent(e.deviceId)}/sessions/${id}`
                          : `/sessions/${id}`
                      }
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 px-4 py-3 transition hover:bg-white/60"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${META[e.event].dot}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-sm font-medium">
                              {basename(e.cwd)}
                            </span>
                            {e.deviceId && (
                              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                {e.deviceId}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs text-ink-faint">
                            {relativeTime(e.at)}
                          </span>
                        </span>
                        <span className="block text-xs text-ink-soft">
                          {META[e.event].label}
                        </span>
                        {e.message && (
                          <span className="clamp-2 mt-0.5 block text-xs text-ink-faint">
                            {e.message}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
