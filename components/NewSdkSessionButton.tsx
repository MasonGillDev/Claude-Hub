"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State = "idle" | "form" | "starting" | "error";

/**
 * Start an in-app (Agent SDK) session for this project. Unlike NewSessionButton
 * (which launches a session in Terminal.app), this one runs in the session
 * daemon and is driven entirely from the dashboard — tool calls surface in the
 * approvals tray. On success we wait for the transcript to materialize, then
 * open it.
 */
export function NewSdkSessionButton({ cwd }: { cwd: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [prompt, setPrompt] = useState("");
  const [approve, setApprove] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function start() {
    if (!prompt.trim()) return;
    setState("starting");
    setMsg(null);
    try {
      const res = await fetch("/api/sdk/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), cwd, approvalMode: approve }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      const id: string = data.id;
      // The transcript appears within a beat; poll briefly so we don't land on a 404.
      for (let i = 0; i < 12; i++) {
        const r = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
        if (r.ok) break;
        await new Promise((res) => setTimeout(res, 300));
      }
      router.push(`/sessions/${id}`);
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Failed to start");
    }
  }

  if (state === "idle") {
    return (
      <button
        onClick={() => setState("form")}
        className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-soft transition hover:from-indigo-600 hover:to-violet-600 active:scale-95"
        title="Run a session inside the dashboard (approve tool calls here)"
      >
        <span aria-hidden className="text-base leading-none">✦</span>
        New in-app session
      </button>
    );
  }

  return (
    <div className="w-full max-w-xl rounded-2xl border border-indigo-200 glass p-3 shadow-soft">
      <textarea
        autoFocus
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
          if (e.key === "Escape") setState("idle");
        }}
        rows={3}
        placeholder="What should this session do? (⌘/Ctrl+Enter to start)"
        className="w-full resize-y rounded-xl border border-indigo-200 bg-white px-3.5 py-2.5 text-sm outline-none ring-indigo-300 focus:ring-2"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={approve}
            onChange={(e) => setApprove(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-500"
          />
          Approve tool calls here
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setState("idle")}
            className="text-sm text-ink-faint hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={start}
            disabled={state === "starting" || !prompt.trim()}
            className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-soft hover:from-indigo-600 hover:to-violet-600 disabled:opacity-50"
          >
            {state === "starting" ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
      {state === "error" && msg && (
        <p className="mt-2 text-xs text-rose-600">{msg}</p>
      )}
    </div>
  );
}
