import { NextResponse } from "next/server";
import {
  deleteSession,
  getSession,
  renameSession,
  sessionExists,
} from "@/lib/claude";
import { setStatus } from "@/lib/status";
import { setApprovalMode } from "@/lib/approvals";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ session });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  let body: { name?: unknown; status?: unknown; approvalMode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const hasName = typeof body.name === "string";
  const hasStatus = "status" in body;
  const hasApprovalMode = "approvalMode" in body;
  if (!hasName && !hasStatus && !hasApprovalMode) {
    return NextResponse.json(
      { error: "Body must include 'name', 'status', and/or 'approvalMode'" },
      { status: 400 },
    );
  }
  if (
    hasStatus &&
    body.status !== null &&
    body.status !== "open" &&
    body.status !== "finished"
  ) {
    return NextResponse.json(
      { error: "'status' must be 'open', 'finished', or null" },
      { status: 400 },
    );
  }
  if (hasApprovalMode && typeof body.approvalMode !== "boolean") {
    return NextResponse.json(
      { error: "'approvalMode' must be a boolean" },
      { status: 400 },
    );
  }
  if (!sessionExists(sessionId)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (hasName) renameSession(sessionId, body.name as string);
  if (hasStatus) setStatus(sessionId, body.status as "open" | "finished" | null);
  if (hasApprovalMode) setApprovalMode(sessionId, body.approvalMode as boolean);

  return NextResponse.json({ session: getSession(sessionId) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const ok = deleteSession(sessionId);
  if (!ok) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
