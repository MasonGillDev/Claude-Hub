import { NextResponse } from "next/server";
import { getDevices } from "@/lib/devices";
import { deviceLastSeen, fetchAgentInfo } from "@/lib/agentClient";

export const dynamic = "force-dynamic";

/** Configured remote devices with a live online probe. Tokens never leave the server. */
export async function GET() {
  const devices = await Promise.all(
    getDevices().map(async (d) => {
      const info = await fetchAgentInfo(d);
      return {
        id: d.id,
        name: info.data?.name ?? d.name,
        url: d.url,
        online: info.online,
        platform: info.data?.platform ?? null,
        agentVersion: info.data?.agentVersion ?? null,
        lastSeen: info.online ? info.fetchedAt : deviceLastSeen(d.id),
        error: info.error,
      };
    }),
  );
  return NextResponse.json({ devices });
}
