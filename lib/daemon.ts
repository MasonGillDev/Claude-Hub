/**
 * Thin client for the session daemon (daemon/index.ts), the separate process
 * that owns live Agent SDK sessions. Next.js route handlers proxy to it so the
 * browser only ever talks to Next; the daemon stays on localhost.
 */
const PORT = process.env.CLAUDE_HUB_DAEMON_PORT ?? "3001";

export const DAEMON_BASE = `http://127.0.0.1:${PORT}`;

/** Thrown when the daemon isn't running (so routes can return a helpful hint). */
export class DaemonDownError extends Error {
  constructor() {
    super(`Session daemon not reachable at ${DAEMON_BASE}. Start it with \`npm run daemon\`.`);
    this.name = "DaemonDownError";
  }
}

export async function daemonFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${DAEMON_BASE}${path}`, { ...init, cache: "no-store" });
  } catch {
    // fetch rejects (ECONNREFUSED) when the daemon process is down.
    throw new DaemonDownError();
  }
}
