import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_DIR,
  getSessionDetail,
  getTranscriptPath,
  listProjects,
  listSessions,
} from "../core/index";

/**
 * Claude Hub device agent — runs on every machine whose sessions should show
 * up in the hub. Read-only over `~/.claude` via `core/`; the hub (the Mac
 * running the Next.js dashboard) polls it over the LAN with a bearer token.
 *
 * Config lives at ~/.claude-hub/agent.json and is created on first run with a
 * generated token. Register the device on the hub by copying that token into
 * the hub's ~/.claude-hub/devices.json (see docs/DEVICES.md).
 *
 * Endpoints (all GET, all token-gated):
 *   /v1/info                          device name, platform, agent version
 *   /v1/projects                      CoreProject[]
 *   /v1/projects/:id/sessions         CoreSession[]
 *   /v1/sessions/:id                  CoreSessionDetail
 *   /v1/sessions/:id/transcript       raw transcript JSONL
 */

const AGENT_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HUB_DIR = path.join(os.homedir(), ".claude-hub");
const CONFIG_FILE = path.join(HUB_DIR, "agent.json");

interface AgentConfig {
  /** Display name the hub shows for this device. */
  name: string;
  /** Shared secret the hub must send as `Authorization: Bearer <token>`. */
  token: string;
  port: number;
  /** Interface to listen on. 0.0.0.0 = reachable from the LAN (token-gated). */
  bind: string;
}

function loadOrCreateConfig(): AgentConfig {
  let existing: Partial<AgentConfig> | null = null;
  try {
    existing = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    // missing or corrupt -> recreate below
  }
  const config: AgentConfig = {
    name: existing?.name?.trim() || os.hostname(),
    token: existing?.token?.trim() || crypto.randomBytes(24).toString("base64url"),
    port: typeof existing?.port === "number" ? existing.port : 3777,
    bind: existing?.bind?.trim() || "0.0.0.0",
  };
  const serialized = JSON.stringify(config, null, 2);
  if (JSON.stringify(existing, null, 2) !== serialized) {
    fs.mkdirSync(HUB_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, serialized);
  }
  return config;
}

const config = loadOrCreateConfig();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authorized(req: http.IncomingMessage): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (!match) return false;
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const got = crypto.createHash("sha256").update(match[1]).digest();
  const want = crypto.createHash("sha256").update(config.token).digest();
  return crypto.timingSafeEqual(got, want);
}

/** A URL path segment that can't escape its directory. */
function safeSegment(s: string): boolean {
  return s.length > 0 && !s.includes("/") && !s.includes("\\") && !s.includes("..");
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const started = Date.now();
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  const finish = (status: number, body: string, contentType: string) => {
    res.writeHead(status, { "content-type": contentType });
    res.end(body);
    console.log(
      `${new Date().toISOString()} ${req.method} ${pathname} ${status} ${Date.now() - started}ms`,
    );
  };
  const json = (status: number, data: unknown) =>
    finish(status, JSON.stringify(data), "application/json");

  if (req.method !== "GET") return json(405, { error: "Method not allowed" });
  if (!authorized(req)) return json(401, { error: "Missing or invalid token" });

  try {
    if (pathname === "/v1/info") {
      return json(200, {
        name: config.name,
        hostname: os.hostname(),
        platform: process.platform,
        agentVersion: AGENT_VERSION,
        claudeDir: CLAUDE_DIR,
        time: new Date().toISOString(),
      });
    }

    if (pathname === "/v1/projects") {
      return json(200, listProjects());
    }

    let m = /^\/v1\/projects\/([^/]+)\/sessions$/.exec(pathname);
    if (m) {
      const projectId = decodeURIComponent(m[1]);
      if (!safeSegment(projectId)) return json(400, { error: "Bad project id" });
      return json(200, listSessions(projectId));
    }

    m = /^\/v1\/sessions\/([^/]+)$/.exec(pathname);
    if (m) {
      const sessionId = decodeURIComponent(m[1]);
      if (!safeSegment(sessionId)) return json(400, { error: "Bad session id" });
      const session = getSessionDetail(sessionId);
      if (!session) return json(404, { error: "Session not found" });
      return json(200, session);
    }

    m = /^\/v1\/sessions\/([^/]+)\/transcript$/.exec(pathname);
    if (m) {
      const sessionId = decodeURIComponent(m[1]);
      if (!safeSegment(sessionId)) return json(400, { error: "Bad session id" });
      const file = getTranscriptPath(sessionId);
      if (!file) return json(404, { error: "Session not found" });
      return finish(200, fs.readFileSync(file, "utf8"), "application/jsonl");
    }

    return json(404, { error: "Not found" });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(config.port, config.bind, () => {
  console.log(`claude-hub-agent v${AGENT_VERSION}`);
  console.log(`  device:  ${config.name} (${process.platform})`);
  console.log(`  serving: ${CLAUDE_DIR}`);
  console.log(`  listen:  http://${config.bind}:${config.port}`);
  console.log(`  config:  ${CONFIG_FILE}`);
  console.log(`  token:   ${config.token}`);
  console.log("");
  console.log("Register on the hub by adding to ~/.claude-hub/devices.json:");
  console.log(
    JSON.stringify(
      {
        id: config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: config.name,
        url: `http://<this-machine's-LAN-IP>:${config.port}`,
        token: config.token,
      },
      null,
      2,
    ),
  );
});
