import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/claude";
import {
  formatDateTime,
  gradientFor,
  nameSourceLabel,
  relativeTime,
} from "@/lib/format";
import { ResumeButton } from "@/components/ResumeButton";
import { RenameField } from "@/components/RenameField";
import { DeleteControl } from "@/components/DeleteControl";
import { SeenOnMount } from "@/components/SeenOnMount";
import { StatusControl } from "@/components/StatusControl";
import { ApprovalModeToggle } from "@/components/ApprovalModeToggle";
import { SessionChat } from "@/components/SessionChat";
import type { Interaction } from "@/lib/claude";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const s = getSession(sessionId);
  if (!s) notFound();

  return (
    <div className="animate-fade-up">
      <SeenOnMount sessionId={s.id} />
      <Link
        href={`/projects/${encodeURIComponent(s.projectId)}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-soft transition hover:text-ink"
      >
        <span aria-hidden>←</span> Back to project
      </Link>

      {/* header */}
      <div className="overflow-hidden rounded-3xl border border-white/70 glass shadow-soft">
        <div className="h-2 w-full" style={{ background: gradientFor(s.id) }} />
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <RenameField
              sessionId={s.id}
              initialName={s.name}
              initialCustom={s.customName}
              variant="block"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge>{nameSourceLabel[s.nameSource] ?? s.nameSource}</Badge>
              {s.running && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  running
                </span>
              )}
              {s.aiTitle && s.nameSource !== "title" && (
                <Badge>title: {s.aiTitle}</Badge>
              )}
              <StatusControl sessionId={s.id} status={s.status} alwaysShow />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ResumeButton sessionId={s.id} running={s.running} />
            <DeleteControl
              url={`/api/sessions/${s.id}`}
              prompt="Delete this session?"
              after={{ type: "push", href: `/projects/${encodeURIComponent(s.projectId)}` }}
              size="md"
            />
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

      {/* approve-from-dashboard toggle */}
      <div className="mt-6">
        <ApprovalModeToggle sessionId={s.id} initial={s.approvalMode} />
      </div>

      {/* live chat — daemon-driven sessions; offers resume for idle ones */}
      <SessionChat sessionId={s.id} running={s.running} />

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

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-700">
      {children}
    </span>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-white/60 px-5 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className={`mt-0.5 truncate text-sm font-medium ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function Bubble({
  interaction,
  fallback,
}: {
  interaction: Interaction | null;
  fallback: string;
}) {
  const isUser = interaction?.role === "user";
  const accent = isUser
    ? "from-sky-400 to-cyan-400"
    : "from-violet-500 to-fuchsia-500";

  return (
    <div className="overflow-hidden rounded-2xl border border-white/70 glass shadow-soft">
      <div className="flex items-center gap-2 border-b border-white/60 px-4 py-2.5">
        <span
          className={`grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br text-[11px] font-bold text-white ${accent}`}
        >
          {isUser ? "U" : "C"}
        </span>
        <span className="text-sm font-semibold">
          {isUser ? "You" : "Claude"}
        </span>
        {interaction?.tools && interaction.tools.length > 0 && (
          <span className="ml-auto truncate font-mono text-xs text-ink-faint">
            used: {interaction.tools.join(", ")}
          </span>
        )}
      </div>
      <div className="px-4 py-3.5">
        {interaction?.text ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">
            {interaction.text}
          </p>
        ) : interaction?.tools && interaction.tools.length > 0 ? (
          <p className="text-sm italic text-ink-faint">
            (No text — ran tools: {interaction.tools.join(", ")})
          </p>
        ) : (
          <p className="text-sm italic text-ink-faint">{fallback}</p>
        )}
      </div>
    </div>
  );
}
