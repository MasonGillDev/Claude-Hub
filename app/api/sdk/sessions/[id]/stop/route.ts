import { NextResponse } from "next/server";
import { DaemonDownError, daemonFetch } from "@/lib/daemon";

export const dynamic = "force-dynamic";

/** Stop a live SDK session (interrupt + close its input). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const r = await daemonFetch(`/sessions/${id}/stop`, { method: "POST" });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (err) {
    if (err instanceof DaemonDownError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
