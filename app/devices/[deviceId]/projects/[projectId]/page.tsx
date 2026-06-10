import Link from "next/link";
import { notFound } from "next/navigation";
import { getDevice } from "@/lib/devices";
import {
  deviceLastSeen,
  fetchAgentProjects,
  fetchAgentSessions,
} from "@/lib/agentClient";
import { decodeProjectId } from "@/core/index";
import { gradientFor, initialsFor, nameSourceLabel } from "@/lib/format";
import { TimeAgo } from "@/components/TimeAgo";

export const dynamic = "force-dynamic";

/** Read-only session list for a project on a remote device. */
export default async function RemoteProjectPage({
  params,
}: {
  params: Promise<{ deviceId: string; projectId: string }>;
}) {
  const { deviceId, projectId } = await params;
  const device = getDevice(decodeURIComponent(deviceId));
  if (!device) notFound();
  const id = decodeURIComponent(projectId);

  const [projectsRes, sessionsRes] = await Promise.all([
    fetchAgentProjects(device),
    fetchAgentSessions(device, id),
  ]);
  const project = projectsRes.data?.find((p) => p.id === id) ?? null;
  const sessions = sessionsRes.data ?? [];
  if (sessionsRes.online && !project && sessions.length === 0) notFound();

  const name = project?.name ?? decodeProjectId(id).split("/").filter(Boolean).at(-1) ?? id;
  const lastSeen = sessionsRes.online
    ? null
    : (sessionsRes.fetchedAt ?? deviceLastSeen(device.id));

  return (
    <div className="animate-fade-up">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-soft transition hover:text-ink"
      >
        <span aria-hidden>←</span> All projects
      </Link>

      <div className="mb-8 flex items-center gap-4">
        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-bold text-white shadow-soft"
          style={{ background: gradientFor(name) }}
        >
          {initialsFor(name)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{name}</h1>
          <p
            className="truncate font-mono text-xs text-ink-faint"
            title={project?.path ?? ""}
          >
            {project?.path ?? decodeProjectId(id)}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          🖥 {device.name}
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              sessionsRes.online ? "bg-emerald-500" : "bg-slate-400"
            }`}
          />
        </span>
      </div>

      {!sessionsRes.online && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
          {device.name} is offline —{" "}
          {lastSeen ? (
            <>
              showing a snapshot from <TimeAgo iso={lastSeen} />.
            </>
          ) : (
            "no snapshot of this project yet."
          )}
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        {sessions.length} session{sessions.length === 1 ? "" : "s"} · read-only
      </h2>

      <div className={`space-y-3 ${sessionsRes.online ? "" : "opacity-70 saturate-50"}`}>
        {sessions.map((s) => (
          <div
            key={s.id}
            className="group relative overflow-hidden rounded-2xl border border-white/70 glass p-4 shadow-soft transition hover:shadow-lift"
          >
            <Link
              href={`/devices/${encodeURIComponent(device.id)}/sessions/${s.id}`}
              className="absolute inset-0 z-10"
              aria-label={`Open ${s.name}`}
            />

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <span className="truncate text-sm font-semibold">{s.name}</span>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                  <span>{nameSourceLabel[s.nameSource] ?? s.nameSource}</span>
                  {s.running && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      running
                    </span>
                  )}
                </div>
                {s.lastPrompt && (
                  <p className="clamp-2 mt-2 text-sm text-ink-soft">{s.lastPrompt}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                  <span>
                    {s.messageCount} message{s.messageCount === 1 ? "" : "s"}
                  </span>
                  {s.gitBranch && s.gitBranch !== "HEAD" && (
                    <span className="font-mono">⎇ {s.gitBranch}</span>
                  )}
                  <span>
                    <TimeAgo iso={s.lastActivity} />
                  </span>
                  <span className="font-mono opacity-60">{s.id.slice(0, 8)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-5 py-4 text-sm text-ink-faint">
            No sessions to show.
          </p>
        )}
      </div>
    </div>
  );
}
