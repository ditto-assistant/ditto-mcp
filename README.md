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

## Tools

The bridge does not define or transform Ditto tools locally. It proxies
`tools/list`, `tools/call`, resources, and resource templates to Ditto's hosted
MCP server, so tool definitions and compatibility behavior come from the
backend.
