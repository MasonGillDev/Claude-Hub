import { NextResponse } from "next/server";
import { getDevice } from "@/lib/devices";
import { fetchAgentProjects } from "@/lib/agentClient";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const { deviceId } = await params;
  const device = getDevice(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Unknown device" }, { status: 404 });
  }
  const result = await fetchAgentProjects(device);
  return NextResponse.json({
    device: { id: device.id, name: device.name },
    online: result.online,
    fetchedAt: result.fetchedAt,
    error: result.error,
    projects: result.data ?? [],
  });
}
