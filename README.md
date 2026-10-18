# Ditto MCP

Local stdio MCP bridge for Ditto Memory.

```json
{
  "mcpServers": {
    "ditto": {
      "command": "npx",
      "args": ["-y", "@heyditto/mcp", "stdio"]
    }
  }
}
```

## Commands

```bash
npx -y @heyditto/mcp login
npx -y @heyditto/mcp status
npx -y @heyditto/mcp stdio
npx -y @heyditto/mcp logout
```

The first `stdio` run also starts login if no valid Ditto OAuth token is
available. The browser is used only for Ditto authorization; MCP traffic is
proxied locally over stdio to Ditto's hosted Streamable HTTP MCP server at
`https://api.heyditto.ai/mcp`.

## Environment

- `DITTO_API_BASE`: Ditto API base URL. Defaults to `https://api.heyditto.ai`.
- `DITTO_CONFIG_DIR`: directory for local OAuth credentials. Defaults to
  `$XDG_CONFIG_HOME/heyditto/mcp` or `~/.config/heyditto/mcp`.

## MCP Apps passthrough

The stdio bridge forwards the connected host's `io.modelcontextprotocol/ui` extension capability when it creates the upstream MCP connection. It waits until the local host has initialized before connecting upstream, preserves tool/resource/result metadata, and leaves text-only hosts on the ordinary tool path. The backend owns UI resources, tools, authorization, and text fallbacks; the bridge does not implement a UI or a second tool catalog.

This enables the standard MCP Apps path through stdio when both the backend and host support it. It does not establish rendering support for every Cursor, Claude, ChatGPT, or Codex product, nor publish a plugin or directory listing. Server-side implementation: [backend#3315](https://github.com/ditto-assistant/backend/pull/3315), tracked in [DITTO-423](https://omniaura-team.atlassian.net/browse/DITTO-423) and [DITTO-426](https://omniaura-team.atlassian.net/browse/DITTO-426).

Run `npm run check` and `npm test` to verify both MCP hops using the official SDK transports. Tests do not log in to or modify a real Ditto account.
