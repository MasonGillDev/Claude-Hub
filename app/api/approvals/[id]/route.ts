import { NextResponse } from "next/server";
import { decideApproval, deleteApproval, getApproval } from "@/lib/approvals";

export const dynamic = "force-dynamic";

/** Poll target for the hook: returns the current decision. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const approval = getApproval(id);
  if (!approval) {
    return NextResponse.json({ decision: "gone" }, { status: 404 });
  }
  return NextResponse.json({ decision: approval.decision });
}

/** UI action: allow or deny a pending approval. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { decision?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.decision !== "allow" && body.decision !== "deny") {
    return NextResponse.json(
      { error: "'decision' must be 'allow' or 'deny'" },
      { status: 400 },
    );
  }
  const approval = decideApproval(id, body.decision);
  if (!approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }
  return NextResponse.json({ approval });
}

/** Hook cleanup once it has read the decision (or timed out). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deleteApproval(id);
  return NextResponse.json({ ok: true });
}
