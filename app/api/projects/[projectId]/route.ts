import { NextResponse } from "next/server";
import { deleteProject, getProject } from "@/lib/claude";

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
  return NextResponse.json({ project });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const ok = deleteProject(projectId);
  if (!ok) {
    return NextResponse.json(
      { error: "Project not found or invalid" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
