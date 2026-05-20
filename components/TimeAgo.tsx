"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/format";

export function TimeAgo({ iso, className }: { iso: string | null; className?: string }) {
  const [label, setLabel] = useState(() => relativeTime(iso));

  useEffect(() => {
    setLabel(relativeTime(iso));
    const t = setInterval(() => setLabel(relativeTime(iso)), 30_000);
    return () => clearInterval(t);
  }, [iso]);

  return (
    <span className={className} suppressHydrationWarning>
      {label}
    </span>
  );
}
