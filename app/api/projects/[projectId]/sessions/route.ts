import { NextResponse } from "next/server";
import { getProject, getSessions } from "@/lib/claude";
import { newSessionCommand, startSessionInTerminal } from "@/lib/resume";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ project, sessions: getSessions(projectId) });
}

/** Start a new Claude session in this project's directory. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  let body: { name?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional for this endpoint
  }
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  try {
    await startSessionInTerminal(project.path, name);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to open Terminal.app",
        detail: err instanceof Error ? err.message : String(err),
        command: newSessionCommand(project.path, name),
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    cwd: project.path,
    command: newSessionCommand(project.path, name),
  });
}
