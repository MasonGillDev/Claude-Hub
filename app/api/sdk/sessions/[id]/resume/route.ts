import { NextResponse } from "next/server";
import { DaemonDownError, daemonFetch } from "@/lib/daemon";
import { getSession } from "@/lib/claude";

export const dynamic = "force-dynamic";

/**
 * Resume a session in the daemon, continuing from its persisted transcript.
 * Works for a stopped in-app session or an idle terminal session (take-over).
 * Refuses a session that's actively running in a terminal (single-writer).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const s = getSession(id);
  if (!s) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (s.running) {
    return NextResponse.json(
      { error: "This session is active in a terminal — stop it there before resuming in-app." },
      { status: 409 },
    );
  }

  let body: { text?: unknown; approvalMode?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  try {
    const r = await daemonFetch(`/sessions/${id}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: typeof body.text === "string" ? body.text : undefined,
        cwd: s.cwd ?? undefined,
        approvalMode: typeof body.approvalMode === "boolean" ? body.approvalMode : undefined,
      }),
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (err) {
    if (err instanceof DaemonDownError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
