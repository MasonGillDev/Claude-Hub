import { NextResponse } from "next/server";
import { DaemonDownError, daemonFetch } from "@/lib/daemon";

export const dynamic = "force-dynamic";

/** List live SDK sessions the daemon owns. Reports daemon liveness for the UI. */
export async function GET() {
  try {
    const res = await daemonFetch("/sessions");
    const data = await res.json();
    return NextResponse.json({ ...data, daemon: "up" });
  } catch (err) {
    if (err instanceof DaemonDownError) {
      return NextResponse.json({ sessions: [], daemon: "down", error: err.message });
    }
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

/** Start an SDK session (proxied to the daemon). Returns the session id. */
export async function POST(req: Request) {
  let body: { prompt?: unknown; cwd?: unknown; model?: unknown; approvalMode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "'prompt' (non-empty string) is required" }, { status: 400 });
  }
  try {
    const res = await daemonFetch("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: body.prompt,
        cwd: typeof body.cwd === "string" ? body.cwd : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        // Default gating ON for UI-started sessions; the daemon seeds the toggle.
        approvalMode: body.approvalMode !== false,
      }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    if (err instanceof DaemonDownError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
