import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getSessions } from "@/lib/claude";
import { gradientFor, initialsFor, nameSourceLabel } from "@/lib/format";
import { TimeAgo } from "@/components/TimeAgo";
import { ResumeButton } from "@/components/ResumeButton";
import { RenameField } from "@/components/RenameField";
import { DeleteControl } from "@/components/DeleteControl";
import { NewSessionButton } from "@/components/NewSessionButton";
import { NewSdkSessionButton } from "@/components/NewSdkSessionButton";
import { StatusControl } from "@/components/StatusControl";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const id = decodeURIComponent(projectId);
  const project = getProject(id);
  if (!project) notFound();
  const sessions = getSessions(id);

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
          style={{ background: gradientFor(project.name) }}
        >
          {initialsFor(project.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {project.name}
          </h1>
          <p className="truncate font-mono text-xs text-ink-faint" title={project.path}>
            {project.path}
          </p>
        </div>
        <DeleteControl
          url={`/api/projects/${encodeURIComponent(id)}`}
          prompt={`Delete this project and all ${sessions.length} session${sessions.length === 1 ? "" : "s"}?`}
          after={{ type: "push", href: "/" }}
          size="md"
        />
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </h2>
        <NewSessionButton projectId={id} />
      </div>

      <div className="mb-4">
        <NewSdkSessionButton cwd={project.path} />
      </div>

      <div className="space-y-3">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group relative overflow-hidden rounded-2xl border glass p-4 shadow-soft transition hover:shadow-lift ${
              s.pendingApproval
                ? "border-indigo-300 ring-2 ring-indigo-400/80"
                : s.attention
                  ? s.attention.event === "needs_input"
                    ? "border-rose-300 ring-2 ring-rose-400/70"
                    : "border-amber-300 ring-2 ring-amber-400/70"
                  : "border-white/70"
            }`}
          >
            {/* stretched click target -> session detail */}
            <Link
              href={`/sessions/${s.id}`}
              className="absolute inset-0 z-10"
              aria-label={`Open ${s.name}`}
            />

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {/* rename controls sit above the link overlay */}
                <div className="relative z-20 inline-flex max-w-full">
                  <RenameField
                    sessionId={s.id}
                    initialName={s.name}
                    initialCustom={s.customName}
                  />
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                  <span>{nameSourceLabel[s.nameSource] ?? s.nameSource}</span>
                  {s.pendingApproval && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse-ring-indigo" />
                      awaiting approval
                    </span>
                  )}
                  {s.attention && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                        s.attention.event === "needs_input"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full animate-pulse-ring ${
                          s.attention.event === "needs_input"
                            ? "bg-rose-500"
                            : "bg-amber-500"
                        }`}
                      />
                      {s.attention.event === "needs_input"
                        ? "needs you"
                        : s.attention.event === "subagent_done"
                          ? "subagent done"
                          : "your turn"}
                    </span>
                  )}
                  {s.running && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      running
                    </span>
                  )}
                  <span className="relative z-20">
                    <StatusControl sessionId={s.id} status={s.status} />
                  </span>
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

              <div className="relative z-20 flex shrink-0 items-center gap-1.5">
                <ResumeButton sessionId={s.id} size="sm" running={s.running} />
                <DeleteControl
                  url={`/api/sessions/${s.id}`}
                  prompt="Delete this session?"
                  after={{ type: "refresh" }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
