"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApprovalModeToggle({
  sessionId,
  initial,
  endpoint,
}: {
  sessionId: string;
  initial: boolean;
  /** PATCH target; defaults to the local session route. Remote session pages
   *  point this at /api/devices/.../approval-mode (same {approvalMode} body). */
  endpoint?: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !on;
    setOn(next);
    setSaving(true);
    try {
      await fetch(endpoint ?? `/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalMode: next }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/70 glass p-4 shadow-soft">
      <button
        role="switch"
        aria-checked={on}
        onClick={toggle}
        disabled={saving}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          on ? "bg-indigo-500" : "bg-ink/15"
        } disabled:opacity-60`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            on ? "left-[1.375rem]" : "left-0.5"
          }`}
        />
      </button>
      <div className="min-w-0">
        <div className="text-sm font-semibold">Approve tool calls from here</div>
        <p className="mt-0.5 text-xs text-ink-soft">
          {on ? (
            <>
              On — <span className="font-medium text-indigo-700">Bash / Edit / Write</span>{" "}
              calls in this session pause and wait up to 20s for your Allow/Deny in
              the dashboard, then fall back to the terminal.
            </>
          ) : (
            <>Off — this session prompts normally in its terminal. Turn on when you’re stepping away.</>
          )}
        </p>
      </div>
    </div>
  );
}
