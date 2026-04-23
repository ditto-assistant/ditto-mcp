#!/usr/bin/env node
import { clearAuth } from "./store.js";
import { authStatus, login } from "./oauth.js";
import { serveStdio } from "./stdio.js";
import { mcpServerURL, packageName, packageVersion } from "./config.js";

function usage(): string {
  return `${packageName} ${packageVersion}

Usage:
  ditto-mcp stdio
  ditto-mcp login
  ditto-mcp logout
  ditto-mcp status
  ditto-mcp config
`;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "stdio";

  switch (command) {
    case "stdio":
      await serveStdio();
      return;
    case "login":
      await login();
      process.stdout.write("Ditto login complete.\n");
      return;
    case "logout":
      await clearAuth();
      process.stdout.write("Ditto local MCP credentials removed.\n");
      return;
    case "status":
      process.stdout.write(`${await authStatus()}\n`);
      return;
    case "config":
      process.stdout.write(
        JSON.stringify(
          {
            mcpServers: {
              ditto: {
                command: "npx",
                args: ["-y", packageName, "stdio"],
              },
            },
            remote: {
              url: mcpServerURL(),
            },
          },
          null,
          2,
        ) + "\n",
      );
      return;
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(usage());
      return;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${usage()}`);
      process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
