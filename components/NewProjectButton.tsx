"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State = "idle" | "form" | "starting" | "ok" | "error";

export function NewProjectButton() {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function start() {
    if (!path.trim()) {
      setState("error");
      setMsg("Enter a directory path");
      return;
    }
    setState("starting");
    setMsg(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: path.trim(),
          name: name.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed");
      setState("ok");
      setMsg("Started in Terminal — refresh once the session begins.");
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
        New project
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-white/70 glass p-4 shadow-soft">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          autoFocus
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") start();
            if (e.key === "Escape") setState("idle");
          }}
          placeholder="Directory path, e.g. ~/code/my-app"
          className="flex-1 rounded-full border border-violet-200 bg-white px-3.5 py-2 font-mono text-sm outline-none ring-violet-300 focus:ring-2"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") start();
            if (e.key === "Escape") setState("idle");
          }}
          placeholder="Optional session name"
          className="rounded-full border border-violet-200 bg-white px-3.5 py-2 text-sm outline-none ring-violet-300 focus:ring-2 sm:w-48"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={start}
            disabled={state === "starting"}
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white shadow-soft hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-60"
          >
            {state === "starting" ? "Starting…" : "Start"}
          </button>
          <button
            onClick={() => {
              setState("idle");
              setMsg(null);
            }}
            className="text-sm text-ink-faint hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
      {msg && (
        <p
          className={`mt-2 text-xs ${
            state === "error" ? "text-rose-600" : "text-emerald-600"
          }`}
        >
          {msg}
          {state === "ok" && (
            <button
              onClick={() => router.refresh()}
              className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 font-semibold text-white hover:bg-emerald-600"
            >
              Refresh
            </button>
          )}
        </p>
      )}
    </div>
  );
}
