"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Status = "open" | "finished" | null;

const OPTS = [
  {
    key: "open" as const,
    label: "Open",
    title: "Open — more work to do in this task",
    active: "bg-sky-500 text-white shadow-soft",
  },
  {
    key: "finished" as const,
    label: "Finished",
    title: "Finished — left in a good state",
    active: "bg-emerald-500 text-white shadow-soft",
  },
];

export function StatusControl({
  sessionId,
  status,
  alwaysShow = false,
}: {
  sessionId: string;
  status: Status;
  alwaysShow?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function set(next: Status, e: React.MouseEvent) {
    stop(e);
    setSaving(true);
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const visible = status !== null || alwaysShow;

  return (
    <div
      onClick={stop}
      className={`inline-flex items-center gap-1 rounded-full bg-black/5 p-0.5 transition ${
        visible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      }`}
    >
      {OPTS.map((o) => {
        const isActive = status === o.key;
        return (
          <button
            key={o.key}
            onClick={(e) => set(isActive ? null : o.key, e)}
            disabled={saving}
            title={isActive ? `${o.title} (click to clear)` : o.title}
            className={`rounded-full px-2 py-0.5 text-xs font-semibold transition disabled:opacity-60 ${
              isActive ? o.active : "text-ink-faint hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
