import crypto from "node:crypto";
import http from "node:http";
import { URLSearchParams } from "node:url";
import { apiBaseURL, packageName } from "./config.js";
import { openBrowser } from "./browser.js";
import { readAuth, writeAuth, type StoredAuth } from "./store.js";

const authSkewMs = 60_000;

interface RegisterResponse {
  client_id: string;
  client_secret?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

function randomBase64Url(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function callbackPage(title: string, detail: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f7f7f8;color:#111}.card{background:#fff;border:1px solid #ddd;border-radius:10px;padding:24px;max-width:360px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#555;margin:0;line-height:1.4}</style></head><body><main class="card"><h1>${title}</h1><p>${detail}</p></main></body></html>`;
}

async function startLoopback(state: string): Promise<{
  redirectUri: string;
  waitForCode: Promise<string>;
}> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: unknown) => void;
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const returnedState = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(callbackPage("Ditto authorization failed", error));
      rejectCode(new Error(error));
      server.close();
      return;
    }

    if (returnedState !== state || !code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(callbackPage("Ditto authorization failed", "Invalid callback state."));
      rejectCode(new Error("OAuth callback state mismatch"));
      server.close();
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(callbackPage("Ditto connected", "You can close this tab and return to your editor."));
    resolveCode(code);
    setTimeout(() => server.close(), 500);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Loopback server address was unavailable");
  }

  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    waitForCode,
  };
}

async function registerClient(redirectUri: string): Promise<RegisterResponse> {
  const response = await fetch(`${apiBaseURL()}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Ditto MCP",
      redirect_uris: [redirectUri],
      scope: "mcp:read mcp:write offline_access",
    }),
  });
  if (!response.ok) {
    throw new Error(`Ditto OAuth registration failed: ${response.status}`);
  }
  return (await response.json()) as RegisterResponse;
}

async function exchangeCode(input: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
  });
  if (input.clientSecret) {
    body.set("client_secret", input.clientSecret);
  }

  const response = await fetch(`${apiBaseURL()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ditto OAuth token exchange failed: ${response.status} ${detail}`);
  }
  return (await response.json()) as TokenResponse;
}

async function refreshToken(auth: StoredAuth): Promise<StoredAuth | null> {
  if (!auth.refreshToken) {
    return null;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
    client_id: auth.clientId,
  });
  if (auth.clientSecret) {
    body.set("client_secret", auth.clientSecret);
  }

  const response = await fetch(`${apiBaseURL()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    return null;
  }

  const token = (await response.json()) as TokenResponse;
  const next: StoredAuth = {
    ...auth,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope ?? auth.scope,
  };
  await writeAuth(next);
  return next;
}

export async function login(): Promise<StoredAuth> {
  const state = randomBase64Url(16);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = pkceChallenge(codeVerifier);
  const loopback = await startLoopback(state);
  const client = await registerClient(loopback.redirectUri);

  const authorize = new URL(`${apiBaseURL()}/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", client.client_id);
  authorize.searchParams.set("redirect_uri", loopback.redirectUri);
  authorize.searchParams.set("scope", "mcp:read mcp:write offline_access");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  process.stderr.write(`Opening Ditto authorization in your browser for ${packageName}.\n`);
  await openBrowser(authorize.toString());
  const code = await loopback.waitForCode;
  const token = await exchangeCode({
    code,
    codeVerifier,
    clientId: client.client_id,
    clientSecret: client.client_secret,
    redirectUri: loopback.redirectUri,
  });

  if (token.token_type.toLowerCase() !== "bearer") {
    throw new Error(`Unsupported Ditto token type: ${token.token_type}`);
  }

  const auth: StoredAuth = {
    clientId: client.client_id,
    clientSecret: client.client_secret,
    redirectUri: loopback.redirectUri,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope,
  };
  await writeAuth(auth);
  return auth;
}

export async function getAccessToken(options: { interactive: boolean }): Promise<string> {
  const existing = await readAuth();
  if (existing && existing.expiresAt > Date.now() + authSkewMs) {
    return existing.accessToken;
  }

  if (existing) {
    const refreshed = await refreshToken(existing);
    if (refreshed) {
      return refreshed.accessToken;
    }
  }

  if (!options.interactive) {
    throw new Error("Ditto is not logged in. Run `npx -y @heyditto/mcp login`.");
  }

  const next = await login();
  return next.accessToken;
}

export async function authStatus(): Promise<"logged-in" | "expired" | "missing"> {
  const existing = await readAuth();
  if (!existing) {
    return "missing";
  }
  if (existing.expiresAt > Date.now() + authSkewMs) {
    return "logged-in";
  }
  return existing.refreshToken ? "expired" : "missing";
}
