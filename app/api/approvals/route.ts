import { NextResponse } from "next/server";
import { createApproval, listPendingApprovals } from "@/lib/approvals";

export const dynamic = "force-dynamic";

/** List pending approvals (for the dashboard tray). */
export function GET() {
  return NextResponse.json({ approvals: listPendingApprovals() });
}

/**
 * Create a pending approval. Called by the PreToolUse hook
 * (`~/.claude-hub/approve-hook.py`) when a session has approval mode ON.
 */
export async function POST(req: Request) {
  let body: {
    id?: unknown;
    sessionId?: unknown;
    tool?: unknown;
    input?: unknown;
    cwd?: unknown;
    deviceId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "string" || typeof body.sessionId !== "string") {
    return NextResponse.json(
      { error: "Missing string 'id' and 'sessionId'" },
      { status: 400 },
    );
  }
  const approval = createApproval({
    id: body.id,
    sessionId: body.sessionId,
    tool: typeof body.tool === "string" ? body.tool : "tool",
    input:
      body.input && typeof body.input === "object"
        ? (body.input as Record<string, unknown>)
        : {},
    cwd: typeof body.cwd === "string" ? body.cwd : null,
    deviceId: typeof body.deviceId === "string" ? body.deviceId : null,
  });
  return NextResponse.json({ approval });
}
