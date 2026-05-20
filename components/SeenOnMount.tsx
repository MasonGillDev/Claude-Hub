"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Clears a session's pending attention once its detail page is opened. */
export function SeenOnMount({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  useEffect(() => {
    let done = false;
    fetch(`/api/events/${sessionId}`, { method: "DELETE" })
      .then(() => {
        if (!done) router.refresh();
      })
      .catch(() => {});
    return () => {
      done = true;
    };
  }, [sessionId, router]);
  return null;
}
