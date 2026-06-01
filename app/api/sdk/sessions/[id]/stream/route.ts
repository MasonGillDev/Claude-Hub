import { NextResponse } from "next/server";
import { DAEMON_BASE } from "@/lib/daemon";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events passthrough for a live SDK session. We stream the daemon's
 * event stream straight through to the browser. A non-live session (daemon 404)
 * or a down daemon returns a non-200 so the client can fall back to the static
 * transcript view.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let upstream: Response;
  try {
    upstream = await fetch(`${DAEMON_BASE}/sessions/${id}/stream`, {
      cache: "no-store",
      signal: req.signal, // abort upstream when the browser disconnects
    });
  } catch {
    return NextResponse.json({ error: "Session daemon not running" }, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Not a live session" }, { status: upstream.status || 404 });
  }

  // Pump the daemon's stream through a guarded ReadableStream instead of returning
  // `upstream.body` directly. When the browser disconnects, `req.signal` aborts the
  // upstream fetch and its body errors with an AbortError; returning the raw body
  // lets that rejection escape unhandled, which exits the Node (dev) process. Here
  // every read error is caught and the stream just closes quietly.
  const body = upstream.body;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        /* upstream aborted (client disconnect) or errored — fall through to close */
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
