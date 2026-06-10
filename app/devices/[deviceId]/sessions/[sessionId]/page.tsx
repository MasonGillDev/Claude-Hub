import Link from "next/link";
import { notFound } from "next/navigation";
import { getDevice } from "@/lib/devices";
import { fetchAgentSession } from "@/lib/agentClient";
import {
  formatDateTime,
  gradientFor,
  nameSourceLabel,
  relativeTime,
} from "@/lib/format";
import { Badge, Bubble, Meta } from "@/components/SessionBits";

export const dynamic = "force-dynamic";

/** Read-only detail view of a session living on a remote device. */
export default async function RemoteSessionPage({
  params,
}: {
  params: Promise<{ deviceId: string; sessionId: string }>;
}) {
  const { deviceId, sessionId } = await params;
  const device = getDevice(decodeURIComponent(deviceId));
  if (!device) notFound();

  const result = await fetchAgentSession(device, decodeURIComponent(sessionId));
  const s = result.data;
  if (!s && result.online) notFound();
  if (!s) {
    return (
      <div className="animate-fade-up">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-soft transition hover:text-ink"
        >
          <span aria-hidden>←</span> All projects
        </Link>
        <div className="rounded-3xl border border-amber-200 bg-amber-50/80 p-8 text-center">
          <h1 className="text-lg font-semibold text-amber-900">
            {device.name} is offline
          </h1>
          <p className="mt-1 text-sm text-amber-800">
            No snapshot of this session yet — it will load once the hub can reach
            the device&apos;s agent.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <Link
        href={`/devices/${encodeURIComponent(device.id)}/projects/${encodeURIComponent(s.projectId)}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-soft transition hover:text-ink"
      >
        <span aria-hidden>←</span> Back to project
      </Link>

      {!result.online && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
          {device.name} is offline — showing a snapshot from{" "}
          {relativeTime(result.fetchedAt)}.
        </div>
      )}

      {/* header */}
      <div className="overflow-hidden rounded-3xl border border-white/70 glass shadow-soft">
        <div className="h-2 w-full" style={{ background: gradientFor(s.id) }} />
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">{s.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge>{nameSourceLabel[s.nameSource] ?? s.nameSource}</Badge>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                🖥 {device.name} · read-only
              </span>
              {s.running && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  running
                </span>
              )}
              {s.aiTitle && s.nameSource !== "title" && (
                <Badge>title: {s.aiTitle}</Badge>
              )}
            </div>
          </div>
        </div>

        {/* meta grid */}
        <div className="grid grid-cols-2 gap-px border-t border-white/60 bg-white/40 sm:grid-cols-4">
          <Meta label="Messages" value={String(s.messageCount)} />
          <Meta label="Git branch" value={s.gitBranch || "—"} mono />
          <Meta label="Last active" value={relativeTime(s.lastActivity)} />
          <Meta label="Created" value={formatDateTime(s.createdAt)} />
        </div>
      </div>

      {/* path + meta strip */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 px-1 text-xs text-ink-faint">
        <span className="font-mono" title={s.cwd ?? ""}>
          📁 {s.cwd ?? "unknown"}
        </span>
        {s.model && <span className="font-mono">model: {s.model}</span>}
        {s.version && <span className="font-mono">claude {s.version}</span>}
        <span className="font-mono">id: {s.id}</span>
      </div>

      {/* away recap */}
      {s.recap && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/80 to-fuchsia-50/60 shadow-soft">
          <div className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-violet-800">
            <span aria-hidden>✦</span> Where you left off
            {s.recap.at && (
              <span className="ml-auto text-xs font-normal text-ink-faint">
                {relativeTime(s.recap.at)}
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap px-4 pb-4 text-sm leading-relaxed text-ink-soft">
            {s.recap.text}
          </p>
        </div>
      )}

      {/* last interaction */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        Last interaction
      </h2>
      <div className="space-y-4">
        <Bubble interaction={s.lastUser} fallback="No user prompt recorded." />
        <Bubble
          interaction={s.lastAssistant}
          fallback="No assistant response recorded."
        />
      </div>
    </div>
  );
}
