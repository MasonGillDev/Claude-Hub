import { NextResponse } from "next/server";
import { getDevice } from "@/lib/devices";
import { postAgentApprovalMode } from "@/lib/agentClient";

export const dynamic = "force-dynamic";

/** Toggle approval mode for a remote session. Mirrors the local
 *  PATCH /api/sessions/[sessionId] {approvalMode} shape so the UI toggle
 *  can target either with the same body. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ deviceId: string; sessionId: string }> },
) {
  const { deviceId, sessionId } = await params;
  const device = getDevice(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Unknown device" }, { status: 404 });
  }
  let body: { approvalMode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.approvalMode !== "boolean") {
    return NextResponse.json(
      { error: "Body must include boolean 'approvalMode'" },
      { status: 400 },
    );
  }
  const result = await postAgentApprovalMode(
    device,
    decodeURIComponent(sessionId),
    body.approvalMode,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Device unreachable" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, approvalMode: body.approvalMode });
}
