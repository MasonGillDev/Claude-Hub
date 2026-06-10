import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CoreProject, CoreSession, CoreSessionDetail } from "@/core/index";
import type { DeviceConfig } from "./devices";

/**
 * HTTP client for remote device agents (`agent/index.ts`), with a last-good
 * snapshot cache so a powered-off device still shows its sessions (marked
 * offline) instead of vanishing. Cache sidecar: ~/.claude-hub/device-cache/<id>.json,
 * one entry per endpoint path.
 */

export interface AgentInfo {
  name: string;
  hostname: string;
  platform: string;
  agentVersion: string;
  claudeDir: string;
  time: string;
}

export interface AgentResult<T> {
  /** Whether the device answered just now. false ⇒ `data` is the cached snapshot, if any. */
  online: boolean;
  /** When `data` was fetched: now if online, the snapshot's time otherwise. */
  fetchedAt: string | null;
  data: T | null;
  error: string | null;
}

const CACHE_DIR = path.join(os.homedir(), ".claude-hub", "device-cache");
const TIMEOUT_MS = 2000;

type CacheFile = Record<string, { at: string; data: unknown }>;

function cacheFile(deviceId: string): string {
  return path.join(CACHE_DIR, `${deviceId}.json`);
}

function readCache(deviceId: string): CacheFile {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(deviceId), "utf8")) as CacheFile;
  } catch {
    return {};
  }
}

function writeCache(deviceId: string, apiPath: string, data: unknown): void {
  const cache = readCache(deviceId);
  cache[apiPath] = { at: new Date().toISOString(), data };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile(deviceId), JSON.stringify(cache));
}

/** Most recent successful fetch across all endpoints — "last seen" for offline devices. */
export function deviceLastSeen(deviceId: string): string | null {
  const times = Object.values(readCache(deviceId)).map((e) => e.at);
  return times.length ? times.sort().at(-1)! : null;
}

async function agentGet<T>(
  device: DeviceConfig,
  apiPath: string,
): Promise<AgentResult<T>> {
  try {
    const res = await fetch(device.url + apiPath, {
      headers: { authorization: `Bearer ${device.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      // The device is up but refused (bad token, unknown session...). Don't
      // mask that with a stale snapshot — report it honestly.
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return {
        online: true,
        fetchedAt: new Date().toISOString(),
        data: null,
        error: body?.error ?? `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as T;
    writeCache(device.id, apiPath, data);
    return { online: true, fetchedAt: new Date().toISOString(), data, error: null };
  } catch (err) {
    const cached = readCache(device.id)[apiPath];
    return {
      online: false,
      fetchedAt: cached?.at ?? null,
      data: (cached?.data as T) ?? null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function fetchAgentInfo(device: DeviceConfig): Promise<AgentResult<AgentInfo>> {
  return agentGet<AgentInfo>(device, "/v1/info");
}

export function fetchAgentProjects(
  device: DeviceConfig,
): Promise<AgentResult<CoreProject[]>> {
  return agentGet<CoreProject[]>(device, "/v1/projects");
}

export function fetchAgentSessions(
  device: DeviceConfig,
  projectId: string,
): Promise<AgentResult<CoreSession[]>> {
  return agentGet<CoreSession[]>(
    device,
    `/v1/projects/${encodeURIComponent(projectId)}/sessions`,
  );
}

export function fetchAgentSession(
  device: DeviceConfig,
  sessionId: string,
): Promise<AgentResult<CoreSessionDetail>> {
  return agentGet<CoreSessionDetail>(
    device,
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
  );
}
