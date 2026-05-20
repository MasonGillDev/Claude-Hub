import { NextResponse } from "next/server";
import { getSessionCwd, getSessionDaemonPids } from "@/lib/claude";
import { clearAttention } from "@/lib/attention";
import {
  focusSessionTerminal,
  resumeCommand,
  resumeInTerminal,
} from "@/lib/resume";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const cwd = getSessionCwd(sessionId);
  if (!cwd) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  clearAttention(sessionId);

  // If the session's terminal is already open, bring that tab to the front
  // instead of opening a second one (which would double-attach the transcript).
  const pids = getSessionDaemonPids(sessionId);
  if (await focusSessionTerminal(pids)) {
    return NextResponse.json({ ok: true, action: "focused", cwd });
  }

  // No open terminal found — open a fresh resume.
  try {
    await resumeInTerminal(sessionId, cwd);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to open Terminal.app",
        detail: err instanceof Error ? err.message : String(err),
        command: resumeCommand(sessionId, cwd),
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    action: "resumed",
    cwd,
    command: resumeCommand(sessionId, cwd),
  });
}
