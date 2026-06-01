import { NextResponse } from "next/server";
import { DaemonDownError, daemonFetch } from "@/lib/daemon";

export const dynamic = "force-dynamic";

/** Send a follow-up user turn to a live SDK session (proxied to the daemon). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "'text' (non-empty string) is required" }, { status: 400 });
  }
  try {
    const r = await daemonFetch(`/sessions/${id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body.text }),
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (err) {
    if (err instanceof DaemonDownError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
