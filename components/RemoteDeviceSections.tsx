import Link from "next/link";
import { getDevices, type DeviceConfig } from "@/lib/devices";
import {
  deviceLastSeen,
  fetchAgentProjects,
  type AgentResult,
} from "@/lib/agentClient";
import type { CoreProject } from "@/core/index";
import { gradientFor, initialsFor } from "@/lib/format";
import { TimeAgo } from "@/components/TimeAgo";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";

/**
 * One section per configured remote device (~/.claude-hub/devices.json) with
 * that device's project grid, fetched live from its agent. Offline devices
 * render their last snapshot, dimmed, with a "last seen" notice. Server
 * component — renders nothing when no devices are configured.
 */
export async function RemoteDeviceSections() {
  const devices = getDevices();
  if (devices.length === 0) return null;

  const results = await Promise.all(
    devices.map(async (device) => ({
      device,
      result: await fetchAgentProjects(device),
    })),
  );

  return (
    <div className="mt-8 space-y-6">
      {results.map(({ device, result }) => (
        <DeviceSection key={device.id} device={device} result={result} />
      ))}
    </div>
  );
}

function DeviceSection({
  device,
  result,
}: {
  device: DeviceConfig;
  result: AgentResult<CoreProject[]>;
}) {
  const projects = result.data ?? [];
  const lastSeen = result.online
    ? null
    : (result.fetchedAt ?? deviceLastSeen(device.id));

  return (
    <CollapsiblePanel
      storageKey={`device-panel:${device.id}`}
      accent={gradientFor(device.id)}
      header={
        <>
          <span className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            🖥 {device.name}
          </span>
          {result.online ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              online
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/80 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              offline
              {lastSeen && (
                <span className="font-normal text-slate-500">
                  · last seen <TimeAgo iso={lastSeen} />
                </span>
              )}
            </span>
          )}
          <span className="text-xs text-ink-faint">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </span>
        </>
      }
    >
      {projects.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-5 py-4 text-sm text-ink-faint">
          {result.online
            ? "No Claude Code sessions on this device yet."
            : "Offline — no snapshot of this device yet. It will appear once the hub reaches its agent."}
        </p>
      ) : (
        <div
          className={`grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 ${
            result.online ? "" : "opacity-60 saturate-50"
          }`}
        >
          {projects.map((p) => (
            <div
              key={p.id}
              className={`group relative overflow-hidden rounded-3xl border glass shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-lift ${
                result.online && p.runningCount > 0
                  ? "border-emerald-300 ring-2 ring-emerald-400/70"
                  : "border-white/70"
              }`}
            >
              <Link
                href={`/devices/${encodeURIComponent(device.id)}/projects/${encodeURIComponent(p.id)}`}
                className="absolute inset-0 z-10"
                aria-label={`Open ${p.name} on ${device.name}`}
              />
              {result.online && p.runningCount > 0 && (
                <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-emerald-700 shadow-soft">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-ring-green" />
                  {p.runningCount} running
                </div>
              )}
              <div
                className="h-20 w-full"
                style={{ background: gradientFor(p.id) }}
              />
              <div className="-mt-8 px-5 pb-5">
                <div
                  className="grid h-16 w-16 place-items-center rounded-2xl text-xl font-bold text-white shadow-lift ring-4 ring-white"
                  style={{ background: gradientFor(p.name) }}
                >
                  {initialsFor(p.name)}
                </div>
                <h3 className="mt-3 truncate text-lg font-semibold tracking-tight">
                  {p.name}
                </h3>
                <p className="truncate font-mono text-xs text-ink-faint" title={p.path}>
                  {p.path}
                </p>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-700">
                    {p.sessionCount} session{p.sessionCount === 1 ? "" : "s"}
                  </span>
                  <span className="text-ink-faint">
                    <TimeAgo iso={p.lastActivity} />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsiblePanel>
  );
}
