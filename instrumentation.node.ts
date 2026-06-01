/**
 * Node-runtime-only startup hook, loaded by instrumentation.ts via dynamic import.
 *
 * Two jobs:
 *  1. Crash guard — the dashboard drives long-lived SSE streams to the daemon; a
 *     stray rejection from a disconnected stream would otherwise take the whole
 *     dev server down. We log such errors instead of letting the process exit.
 *  2. Bring up the session daemon alongside the app, so `npm run dev` is the only
 *     command you need — no separate `npm run daemon` to babysit. Port-guarded so
 *     we never spawn a second one; detached so it outlives dev hot-reloads.
 */
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

process.on("unhandledRejection", (reason) => {
  console.error("[claude-hub] unhandledRejection (kept server alive):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[claude-hub] uncaughtException (kept server alive):", err);
});

const DAEMON_PORT = Number(process.env.CLAUDE_HUB_DAEMON_PORT ?? 3001);

/** Resolve true if something is already listening on the daemon port. */
function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const finish = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.once("connect", () => finish(true));
    sock.once("error", () => resolve(false));
    sock.setTimeout(1000, () => finish(false));
  });
}

/** Start the session daemon if it isn't already up. */
async function ensureDaemon(): Promise<void> {
  if (await portOpen(DAEMON_PORT)) return; // already running — reuse it
  try {
    const hubDir = path.join(os.homedir(), ".claude-hub");
    fs.mkdirSync(hubDir, { recursive: true });
    const log = fs.openSync(path.join(hubDir, "daemon.log"), "a");
    const child = spawn("npm", ["run", "daemon"], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env,
    });
    child.unref();
    console.log(
      `[claude-hub] started session daemon (pid ${child.pid}); logs → ~/.claude-hub/daemon.log`,
    );
  } catch (err) {
    console.error("[claude-hub] failed to start session daemon:", err);
  }
}

void ensureDaemon();

export {}; // mark this side-effect file as a module (so dynamic import() resolves it)
