"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Framed, collapsible section used to group each device's projects on the
 * home page. The accent strip + frame keep devices visually separate, and
 * the open/closed state persists per `storageKey` in localStorage.
 */
export function CollapsiblePanel({
  storageKey,
  accent,
  header,
  children,
}: {
  storageKey: string;
  /** CSS background for the top accent strip (per-device gradient). */
  accent: string;
  /** Row content shown in the always-visible header (chips, counts...). */
  header: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(storageKey) === "closed") setOpen(false);
  }, [storageKey]);

  const toggle = () =>
    setOpen((o) => {
      localStorage.setItem(storageKey, o ? "closed" : "open");
      return !o;
    });

  return (
    <section className="overflow-hidden rounded-3xl border border-white/70 glass shadow-soft">
      <div className="h-1.5 w-full" style={{ background: accent }} />
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 px-5 py-4 text-left transition hover:bg-white/40"
      >
        {header}
        <span
          aria-hidden
          className={`ml-auto text-lg leading-none text-ink-faint transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}
