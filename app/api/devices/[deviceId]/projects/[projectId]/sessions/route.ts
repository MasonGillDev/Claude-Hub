import { NextResponse } from "next/server";
import { getDevice } from "@/lib/devices";
import { fetchAgentSessions } from "@/lib/agentClient";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deviceId: string; projectId: string }> },
) {
  const { deviceId, projectId } = await params;
  const device = getDevice(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Unknown device" }, { status: 404 });
  }
  const result = await fetchAgentSessions(device, decodeURIComponent(projectId));
  return NextResponse.json({
    device: { id: device.id, name: device.name },
    online: result.online,
    fetchedAt: result.fetchedAt,
    error: result.error,
    sessions: result.data ?? [],
  });
}
