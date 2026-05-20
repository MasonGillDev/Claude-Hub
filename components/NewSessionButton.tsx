"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State = "idle" | "form" | "starting" | "ok" | "error";

export function NewSessionButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function start() {
    setState("starting");
    setMsg(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/sessions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() || undefined }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed");
      setState("ok");
      setMsg("Started in Terminal — it'll appear here after the first prompt.");
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  if (state === "idle") {
    return (
      <button
        onClick={() => setState("form")}
        className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white shadow-soft transition hover:from-violet-600 hover:to-fuchsia-600 active:scale-95"
      >
        <span aria-hidden className="text-base leading-none">＋</span>
        New session
      </button>
    );
  }

  if (state === "ok") {
    return (
      <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700">
        <span>{msg}</span>
        <button
          onClick={() => router.refresh()}
          className="rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-emerald-600"
        >
          Refresh
        </button>
        <button
          onClick={() => {
            setState("idle");
            setName("");
          }}
          className="text-xs text-emerald-700/70 hover:text-emerald-900"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") start();
          if (e.key === "Escape") setState("idle");
        }}
        placeholder="Optional name (e.g. auth-refactor)"
        className="w-56 rounded-full border border-violet-200 bg-white px-3.5 py-2 text-sm outline-none ring-violet-300 focus:ring-2"
      />
      <button
        onClick={start}
        disabled={state === "starting"}
        className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white shadow-soft hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-60"
      >
        {state === "starting" ? "Starting…" : "Start"}
      </button>
      <button
        onClick={() => setState("idle")}
        className="text-sm text-ink-faint hover:text-ink"
      >
        Cancel
      </button>
      {state === "error" && msg && (
        <span className="text-xs text-rose-600">{msg}</span>
      )}
    </div>
  );
}
