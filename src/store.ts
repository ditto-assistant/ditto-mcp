import fs from "node:fs/promises";
import { authFilePath, configDir } from "./config.js";

export interface StoredAuth {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
}

export async function readAuth(): Promise<StoredAuth | null> {
  try {
    const raw = await fs.readFile(authFilePath(), "utf8");
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed.clientId || !parsed.accessToken || !parsed.expiresAt) {
      return null;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeAuth(auth: StoredAuth): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(authFilePath(), `${JSON.stringify(auth, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.chmod(authFilePath(), 0o600).catch(() => undefined);
}

export async function clearAuth(): Promise<void> {
  await fs.rm(authFilePath(), { force: true });
}
