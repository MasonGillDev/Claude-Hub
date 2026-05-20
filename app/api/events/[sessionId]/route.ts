import { NextResponse } from "next/server";
import { clearAttention } from "@/lib/attention";

export const dynamic = "force-dynamic";

/** Clear attention for a session (e.g. once the user has seen / resumed it). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  clearAttention(sessionId);
  return NextResponse.json({ ok: true });
}
