import { NextResponse } from "next/server";
import { getDevice } from "@/lib/devices";
import { fetchAgentSession } from "@/lib/agentClient";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deviceId: string; sessionId: string }> },
) {
  const { deviceId, sessionId } = await params;
  const device = getDevice(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Unknown device" }, { status: 404 });
  }
  const result = await fetchAgentSession(device, decodeURIComponent(sessionId));
  if (!result.data) {
    return NextResponse.json(
      {
        error: result.error ?? "Session not found",
        online: result.online,
      },
      { status: result.online ? 404 : 503 },
    );
  }
  return NextResponse.json({
    device: { id: device.id, name: device.name },
    online: result.online,
    fetchedAt: result.fetchedAt,
    session: result.data,
  });
}
