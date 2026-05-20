"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "ok" | "error";

export function ResumeButton({
  sessionId,
  className,
  size = "md",
  running = false,
}: {
  sessionId: string;
  className?: string;
  size?: "sm" | "md";
  running?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [okLabel, setOkLabel] = useState("Opened");

  async function resume(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/resume`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed");

      setStatus("ok");
      setOkLabel(data.action === "focused" ? "Focused" : "Opened");
      setMessage(
        data.action === "focused" ? "Brought to front" : "Opened in Terminal",
      );
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Failed");
      setTimeout(() => setStatus("idle"), 4000);
    }
  }

  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const idleLabel = running ? "Focus" : "Resume";
  const label =
    status === "loading"
      ? running
        ? "Focusing…"
        : "Opening…"
      : status === "ok"
        ? `${okLabel} ✓`
        : status === "error"
          ? "Failed"
          : idleLabel;

  const tone =
    status === "error"
      ? "bg-rose-500"
      : status === "ok"
        ? "bg-emerald-500"
        : running
          ? "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
          : "bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600";

  return (
    <button
      onClick={resume}
      disabled={status === "loading"}
      title={message ?? (running ? "Bring this session's terminal to the front" : "Open a Terminal and resume this session")}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium text-white shadow-soft transition active:scale-95 disabled:opacity-70 ${pad} ${tone} ${className ?? ""}`}
    >
      <span aria-hidden>▸</span>
      {label}
    </button>
  );
}
