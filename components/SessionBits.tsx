import type { Interaction } from "@/core/index";

/** Presentational pieces shared by the local and remote session detail pages. */

export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-700">
      {children}
    </span>
  );
}

export function Meta({
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

export function Bubble({
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
