import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Registry of remote devices whose agents the hub can talk to. Config sidecar:
 * ~/.claude-hub/devices.json:
 *
 *   {
 *     "devices": [
 *       { "id": "windows-pc", "name": "Windows PC",
 *         "url": "http://192.168.1.50:3777", "token": "<from that device's agent.json>" }
 *     ]
 *   }
 *
 * The local machine is NOT listed here — the hub reads its own ~/.claude
 * in-process via lib/claude.ts.
 */

export interface DeviceConfig {
  /** Stable id used in URLs and cache filenames, e.g. "windows-pc". */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** Agent origin, e.g. "http://192.168.1.50:3777". */
  url: string;
  /** Bearer token from that device's ~/.claude-hub/agent.json. */
  token: string;
}

const DEVICES_FILE = path.join(os.homedir(), ".claude-hub", "devices.json");

/** Keep ids safe for URL segments and cache filenames. */
function sanitizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

export function getDevices(): DeviceConfig[] {
  let parsed: { devices?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(DEVICES_FILE, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.devices)) return [];
  return parsed.devices
    .filter(
      (d): d is DeviceConfig =>
        !!d &&
        typeof d.id === "string" &&
        d.id.trim() !== "" &&
        typeof d.name === "string" &&
        typeof d.url === "string" &&
        typeof d.token === "string",
    )
    .map((d) => ({
      ...d,
      id: sanitizeId(d.id),
      url: d.url.replace(/\/+$/, ""),
    }));
}

export function getDevice(deviceId: string): DeviceConfig | null {
  return getDevices().find((d) => d.id === deviceId) ?? null;
}
