import { NextResponse } from "next/server";
import { getProjects, validateDirectory } from "@/lib/claude";
import { newSessionCommand, startSessionInTerminal } from "@/lib/resume";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ projects: getProjects() });
}

/** Start a new Claude session in a directory (creates a new project once it runs). */
export async function POST(req: Request) {
  let body: { path?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.path !== "string") {
    return NextResponse.json(
      { error: "Body must include a string 'path'" },
      { status: 400 },
    );
  }
  const check = validateDirectory(body.path);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  try {
    await startSessionInTerminal(check.path, name);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to open Terminal.app",
        detail: err instanceof Error ? err.message : String(err),
        command: newSessionCommand(check.path, name),
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    cwd: check.path,
    command: newSessionCommand(check.path, name),
  });
}
