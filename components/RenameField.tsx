"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RenameField({
  sessionId,
  initialName,
  initialCustom,
  variant = "inline",
}: {
  sessionId: string;
  initialName: string;
  initialCustom: string | null;
  /** "inline" = compact pencil-to-edit; "block" = larger field for detail page. */
  variant?: "inline" | "block";
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialCustom ?? initialName);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      const data = await res.json();
      if (res.ok) {
        setName(data.session.name);
        setEditing(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  function startEdit(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setEditing(true);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") {
      setValue(initialCustom ?? name);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div
        className="flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder="Session name"
          className={`min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-2.5 py-1 outline-none ring-violet-300 focus:ring-2 ${
            variant === "block" ? "text-lg font-semibold" : "text-sm"
          }`}
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            save();
          }}
          disabled={saving}
          className="rounded-lg bg-violet-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-60"
        >
          {saving ? "…" : "Save"}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setValue(initialCustom ?? name);
            setEditing(false);
          }}
          className="rounded-lg px-2 py-1 text-xs text-ink-faint hover:text-ink"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className={`truncate ${
          variant === "block" ? "text-2xl font-bold" : "font-semibold"
        }`}
      >
        {name}
      </span>
      <button
        onClick={startEdit}
        title="Rename"
        className="shrink-0 rounded-md p-1 text-ink-faint opacity-0 transition hover:bg-violet-50 hover:text-violet-600 group-hover:opacity-100 data-[block=true]:opacity-100"
        data-block={variant === "block"}
        aria-label="Rename session"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
    </div>
  );
}
