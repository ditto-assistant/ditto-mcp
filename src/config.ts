import os from "node:os";
import path from "node:path";

export const packageName = "@heyditto/mcp";
export const packageVersion = "0.1.0";

export function apiBaseURL(): string {
  return (process.env.DITTO_API_BASE || "https://api.heyditto.ai").replace(/\/+$/, "");
}

export function mcpServerURL(): string {
  return `${apiBaseURL()}/mcp`;
}

export function configDir(): string {
  if (process.env.DITTO_CONFIG_DIR) {
    return process.env.DITTO_CONFIG_DIR;
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "heyditto", "mcp");
}

export function authFilePath(): string {
  return path.join(configDir(), "auth.json");
}
