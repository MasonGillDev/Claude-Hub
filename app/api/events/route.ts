import { NextResponse } from "next/server";
import {
  clearAllAttention,
  clearAttention,
  clearAttentionForRunning,
  getAttention,
  mapHookEvent,
  setAttention,
} from "@/lib/attention";
import { getRunningSessionIds } from "@/lib/claude";

export const dynamic = "force-dynamic";

/** Poll target for the dashboard (attention + live running ids). */
export function GET() {
  const running = getRunningSessionIds();
  // A running (busy) session can't also be waiting on you — drop stale attention.
  clearAttentionForRunning(running);
  return NextResponse.json({ attention: getAttention(), running });
}

/** Dismiss all pending attention. */
export function DELETE() {
  clearAllAttention();
  return NextResponse.json({ ok: true });
}

/**
 * Hook target. Accepts a Claude Code hook payload (or a simple {session_id,event}).
 *
 * Caller is NOT in this repo: `~/.claude-hub/notify-hook.py`, wired via hooks in
 * `~/.claude/settings.json` (Stop/Notification/SubagentStop/UserPromptSubmit).
 * That script does two things on each event: POSTs here (drives the in-app bell/
 * pulse) AND fires the native macOS banner via `osascript`. So the banner code is
 * intentionally outside this codebase — see CLAUDE.md "Notifications".
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = (body.session_id ?? body.sessionId) as string | undefined;
  const eventName = (body.hook_event_name ?? body.event) as string | undefined;
  if (!sessionId || !eventName) {
    return NextResponse.json(
      { error: "Missing session_id or event" },
      { status: 400 },
    );
  }

  const mapped = mapHookEvent(eventName);
  if (mapped === null) {
    return NextResponse.json({ ok: true, ignored: eventName });
  }
  if (mapped === "clear") {
    clearAttention(sessionId);
    return NextResponse.json({ ok: true, cleared: true });
  }

  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : null;
  const cwd = typeof body.cwd === "string" ? body.cwd : null;
  setAttention(sessionId, mapped, message, cwd);
  return NextResponse.json({ ok: true, event: mapped });
}
