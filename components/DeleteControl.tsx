"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State = "idle" | "confirm" | "deleting" | "error";

export function DeleteControl({
  url,
  prompt,
  after,
  size = "sm",
}: {
  url: string;
  /** Short confirmation question, e.g. "Delete this session?" */
  prompt: string;
  /** What to do on success. */
  after: { type: "refresh" } | { type: "push"; href: string };
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [err, setErr] = useState<string | null>(null);

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function doDelete(e: React.MouseEvent) {
    stop(e);
    setState("deleting");
    setErr(null);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      if (after.type === "push") router.push(after.href);
      else router.refresh();
    } catch (e2) {
      setState("error");
      setErr(e2 instanceof Error ? e2.message : "Failed");
      setTimeout(() => setState("idle"), 3500);
    }
  }

  const iconBtn =
    size === "sm" ? "h-7 w-7 text-[13px]" : "h-9 w-9 text-base";

  if (state === "idle" || state === "error") {
    return (
      <button
        onClick={(e) => {
          stop(e);
          setState("confirm");
        }}
        title={err ?? "Delete"}
        className={`grid place-items-center rounded-lg text-ink-faint transition hover:bg-rose-50 hover:text-rose-600 ${iconBtn} ${
          state === "error" ? "bg-rose-50 text-rose-600" : ""
        }`}
        aria-label="Delete"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-2 py-1"
      onClick={stop}
    >
      <span className="text-xs font-medium text-rose-700">{prompt}</span>
      <button
        onClick={doDelete}
        disabled={state === "deleting"}
        className="rounded-md bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
      >
        {state === "deleting" ? "…" : "Delete"}
      </button>
      <button
        onClick={(e) => {
          stop(e);
          setState("idle");
        }}
        className="rounded-md px-1.5 py-0.5 text-xs text-ink-soft hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}
