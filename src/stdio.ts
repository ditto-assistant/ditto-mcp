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
  type ClientCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import { mcpServerURL, packageVersion } from "./config.js";
import { getAccessToken } from "./oauth.js";

const uiExtension = "io.modelcontextprotocol/ui";

// Forward only the UI extension. Sampling, elicitation, roots and tasks would
// require additional proxy handlers before this bridge could advertise them.
export function appCapabilities(capabilities?: ClientCapabilities): ClientCapabilities {
  const ui = capabilities?.extensions?.[uiExtension];
  return ui ? { extensions: { [uiExtension]: structuredClone(ui) } } : {};
}

async function connectRemote(capabilities: ClientCapabilities): Promise<Client> {
  const token = await getAccessToken({ interactive: true });
  const client = new Client(
    { name: "ditto-mcp-stdio-bridge", version: packageVersion },
    { capabilities },
  );
  const transport = new StreamableHTTPClientTransport(new URL(mcpServerURL()), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
  return client;
}

export function createStdioBridge(connect = connectRemote): Server {
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

  // The local initialize must finish before creating the upstream client:
  // otherwise the backend never learns that the real host supports MCP Apps.
  // Concurrent initial requests share a connection; a failed login/connect may
  // be retried by a later request rather than poisoning the bridge permanently.
  let remote: Promise<Client> | undefined;
  let closed = false;
  const getRemote = (): Promise<Client> => {
    if (closed) return Promise.reject(new Error("Ditto MCP bridge is closed"));
    if (!remote) {
      remote = connect(appCapabilities(server.getClientCapabilities())).catch((error) => {
        remote = undefined;
        throw error;
      });
    }
    return remote;
  };
  server.onclose = () => {
    closed = true;
    void remote?.then((client) => client.close()).catch(() => {});
  };

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return (await getRemote()).listTools(request.params);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return (await getRemote()).callTool(request.params);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    return (await getRemote()).listResources(request.params);
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return (await getRemote()).readResource(request.params);
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
    return (await getRemote()).listResourceTemplates(request.params);
  });

  return server;
}

export async function serveStdio(): Promise<void> {
  const server = createStdioBridge();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
