import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { appCapabilities, createStdioBridge } from "../dist/stdio.js";

const extension = "io.modelcontextprotocol/ui";
const mime = "text/html;profile=mcp-app";
const ui = { mimeTypes: [mime], futureSetting: { version: 1 } };
const uri = "ui://ditto/memories/v1.html";
const tool = {
  name: "fetch_memories", inputSchema: { type: "object", properties: { ids: { type: "array" } } },
  annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: uri, visibility: ["model", "app"] }, unrelated: "preserve-me" },
};
const resource = { uri, name: "Memory inspector", mimeType: mime, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } };
const output = { content: [{ type: "text", text: '{"memories":[]}' }], structuredContent: { memories: [] }, _meta: { "ai.heyditto/memory-view": { accountId: "qa", kgId: "app_team_owner", kgAlias: "team/project" } } };

async function fixture(t, hostCapabilities = {}, failFirst = false) {
  const upstream = new Server({ name: "test-backend", version: "1" }, { capabilities: { tools: {}, resources: {} } });
  const calls = [];
  upstream.setRequestHandler(ListToolsRequestSchema, async (request) => {
    calls.push(request);
    const supportsUI = upstream.getClientCapabilities()?.extensions?.[extension]?.mimeTypes?.includes(mime);
    return { tools: [supportsUI ? tool : { ...tool, _meta: undefined }], nextCursor: "tools-next" };
  });
  upstream.setRequestHandler(ListResourcesRequestSchema, async (request) => { calls.push(request); return { resources: [resource], nextCursor: "resources-next" }; });
  upstream.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => { calls.push(request); return { resourceTemplates: [], nextCursor: "templates-next" }; });
  upstream.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    calls.push(request);
    return { contents: [{ ...resource, text: "<!doctype html><title>Test view</title>" }] };
  });
  upstream.setRequestHandler(CallToolRequestSchema, async (request) => {
    calls.push(request);
    if (request.params.arguments?.ids?.includes("denied")) return { isError: true, content: [{ type: "text", text: "access denied" }] };
    return output;
  });
  let connections = 0;
  let remote;
  const bridge = createStdioBridge(async (capabilities) => {
    connections++;
    if (failFirst && connections === 1) throw new Error("upstream temporarily unavailable");
    remote = new Client({ name: "test-bridge", version: "1" }, { capabilities });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await upstream.connect(serverTransport);
    await remote.connect(clientTransport);
    return remote;
  });
  const host = new Client({ name: "generic-host", version: "1" }, { capabilities: hostCapabilities });
  const [hostTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
  await bridge.connect(bridgeTransport);
  await host.connect(hostTransport);
  t.after(async () => { await host.close(); await bridge.close(); await remote?.close(); await upstream.close(); });
  return { host, upstream, calls, connections: () => connections };
}

test("UI capability reaches upstream after host initialize and metadata survives both hops", async (t) => {
  const f = await fixture(t, { extensions: { [extension]: ui }, sampling: {} });
  assert.equal(f.connections(), 0, "upstream must wait for the host capability handshake");
  const listed = await f.host.listTools();
  assert.equal(f.connections(), 1);
  assert.deepEqual(f.upstream.getClientCapabilities(), { extensions: { [extension]: ui } });
  assert.deepEqual(listed.tools[0], tool);
  const data = await f.host.callTool({ name: "fetch_memories", arguments: { ids: ["pair-1"], kg: "team/project" }, _meta: { correlation: "widget-1" } });
  assert.deepEqual(data, output);
  const contents = await f.host.readResource({ uri });
  assert.equal(contents.contents[0].mimeType, mime);
  assert.deepEqual(contents.contents[0]._meta, resource._meta);
  assert.equal(f.calls.at(-2).params._meta.correlation, "widget-1");
});

test("text-only hosts do not acquire fabricated UI or other client capabilities", async (t) => {
  const f = await fixture(t, { sampling: {}, roots: { listChanged: true } });
  const listed = await f.host.listTools();
  assert.deepEqual(f.upstream.getClientCapabilities(), {});
  assert.equal(listed.tools[0]._meta, undefined);
  const data = await f.host.callTool({ name: "fetch_memories", arguments: { ids: ["pair-1"] } });
  assert.deepEqual(data.content, output.content);
});

test("concurrent first requests share the connection and preserve pagination", async (t) => {
  const f = await fixture(t, { extensions: { [extension]: ui } });
  const [tools, resources, templates] = await Promise.all([
    f.host.listTools({ cursor: "tools-page" }),
    f.host.listResources({ cursor: "resources-page" }),
    f.host.listResourceTemplates({ cursor: "templates-page" }),
  ]);
  assert.equal(f.connections(), 1);
  assert.deepEqual(f.calls.map((request) => request.params.cursor).sort(), ["resources-page", "templates-page", "tools-page"]);
  assert.equal(tools.nextCursor, "tools-next");
  assert.equal(resources.nextCursor, "resources-next");
  assert.equal(templates.nextCursor, "templates-next");
});

test("backend denials remain errors rather than usable UI results", async (t) => {
  const f = await fixture(t, { extensions: { [extension]: ui } });
  const denied = await f.host.callTool({ name: "fetch_memories", arguments: { ids: ["denied"] } });
  assert.deepEqual(denied, { isError: true, content: [{ type: "text", text: "access denied" }] });
});

test("a failed upstream connection can be retried with the same negotiated capabilities", async (t) => {
  const f = await fixture(t, { extensions: { [extension]: ui } }, true);
  await assert.rejects(f.host.listTools(), /temporarily unavailable/);
  const listed = await f.host.listTools();
  assert.equal(f.connections(), 2);
  assert.deepEqual(listed.tools[0]._meta, tool._meta);
});

test("capability filtering copies UI settings without claiming unimplemented proxies", () => {
  const source = { extensions: { [extension]: structuredClone(ui), "other-extension": {} }, elicitation: {}, tasks: {} };
  const forwarded = appCapabilities(source);
  forwarded.extensions[extension].mimeTypes.push("other-type");
  assert.deepEqual(source.extensions[extension], ui);
  assert.equal(forwarded.extensions["other-extension"], undefined);
  assert.equal(forwarded.elicitation, undefined);
  assert.equal(forwarded.tasks, undefined);
});
