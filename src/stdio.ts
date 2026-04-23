import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mcpServerURL, packageVersion } from "./config.js";
import { getAccessToken } from "./oauth.js";

async function connectRemote(): Promise<Client> {
  const token = await getAccessToken({ interactive: true });
  const client = new Client({
    name: "ditto-mcp-stdio-bridge",
    version: packageVersion,
  });
  const transport = new StreamableHTTPClientTransport(new URL(mcpServerURL()), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  await client.connect(transport);
  return client;
}

export async function serveStdio(): Promise<void> {
  const remote = await connectRemote();
  const server = new Server(
    {
      name: "ditto-memory",
      version: packageVersion,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return remote.listTools();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return remote.callTool(request.params);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return remote.listResources();
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return remote.readResource(request.params);
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return remote.listResourceTemplates();
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
