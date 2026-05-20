import Link from "next/link";

export default function NotFound() {
  return (
    <div className="animate-fade-up rounded-3xl border border-white/70 glass p-12 text-center shadow-soft">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-400 text-2xl text-white">
        ?
      </div>
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-ink-soft">
        That project or session doesn’t exist anymore.
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white shadow-soft transition hover:from-violet-600 hover:to-fuchsia-600"
      >
        Back to projects
      </Link>
    </div>
  );
}
