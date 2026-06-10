import os from "node:os";
import Link from "next/link";
import { getProjects } from "@/lib/claude";
import { getDevices } from "@/lib/devices";
import { gradientFor, initialsFor } from "@/lib/format";
import { TimeAgo } from "@/components/TimeAgo";
import { DeleteControl } from "@/components/DeleteControl";
import { NewProjectButton } from "@/components/NewProjectButton";
import { PendingActionsPanel } from "@/components/PendingActionsPanel";
import { RemoteDeviceSections } from "@/components/RemoteDeviceSections";

export const dynamic = "force-dynamic";

export default function Home() {
  const projects = getProjects();
  const hasRemoteDevices = getDevices().length > 0;

  return (
    <div className="animate-fade-up">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your projects</h1>
          <p className="mt-1 text-ink-soft">
            {projects.length} project{projects.length === 1 ? "" : "s"} with Claude
            Code sessions{hasRemoteDevices ? " on this Mac" : ""}. Pick one to dive in.
          </p>
        </div>
        <NewProjectButton />
      </div>

      {hasRemoteDevices && (
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
            💻 This Mac · {os.hostname()}
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-700">
            local
          </span>
        </div>
      )}

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`group relative overflow-hidden rounded-3xl border glass shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-lift ${
                p.pendingApprovalCount > 0
                  ? "border-indigo-300 ring-2 ring-indigo-400/80"
                  : p.attentionCount > 0
                    ? "border-amber-300 ring-2 ring-amber-400/70"
                    : p.runningCount > 0
                      ? "border-emerald-300 ring-2 ring-emerald-400/70"
                      : "border-white/70"
              }`}
            >
              <Link
                href={`/projects/${encodeURIComponent(p.id)}`}
                className="absolute inset-0 z-10"
                aria-label={`Open ${p.name}`}
              />
              {p.pendingApprovalCount > 0 ? (
                <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-indigo-700 shadow-soft">
                  <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse-ring-indigo" />
                  {p.pendingApprovalCount} to approve
                </div>
              ) : p.attentionCount > 0 ? (
                <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-amber-700 shadow-soft">
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse-ring" />
                  {p.attentionCount} waiting
                </div>
              ) : p.runningCount > 0 ? (
                <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-emerald-700 shadow-soft">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-ring-green" />
                  {p.runningCount} running
                </div>
              ) : null}
              <div
                className="h-20 w-full"
                style={{ background: gradientFor(p.id) }}
              />
              {/* delete sits above the stretched link */}
              <div className="absolute right-3 top-3 z-20 opacity-0 transition group-hover:opacity-100">
                <DeleteControl
                  url={`/api/projects/${encodeURIComponent(p.id)}`}
                  prompt="Delete project?"
                  after={{ type: "refresh" }}
                />
              </div>
              <div className="-mt-8 px-5 pb-5">
                <div
                  className="grid h-16 w-16 place-items-center rounded-2xl text-xl font-bold text-white shadow-lift ring-4 ring-white"
                  style={{ background: gradientFor(p.name) }}
                >
                  {initialsFor(p.name)}
                </div>
                <h2 className="mt-3 truncate text-lg font-semibold tracking-tight">
                  {p.name}
                </h2>
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

      <RemoteDeviceSections />

      <PendingActionsPanel />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-dashed border-violet-200 bg-white/60 p-12 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-400 text-2xl text-white">
        ✦
      </div>
      <h2 className="text-lg font-semibold">No projects yet</h2>
      <p className="mx-auto mt-1 max-w-md text-ink-soft">
        Start a Claude Code session in any directory and it will show up here.
        Claude Hub reads from <code className="font-mono">~/.claude/projects</code>.
      </p>
    </div>
  );
}
