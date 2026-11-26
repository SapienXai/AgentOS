const { randomBytes } = require("node:crypto");
const { appendFile } = require("node:fs/promises");
const { createServer } = require("node:http");
const { createRequire } = require("node:module");
const path = require("node:path");

function createMcpServer(sdkRoot, receipt, transport) {
  const fromSdk = createRequire(path.join(sdkRoot, "package.json"));
  const { McpServer } = fromSdk("@modelcontextprotocol/sdk/server/mcp.js");
  const { z } = fromSdk("zod");
  const server = new McpServer({ name: "workspace-proof", version: "1.0.0" });
  server.registerTool("workspace_fact", {
    description: "Return a unique synthetic catalogue fact for the supplied request ID.",
    inputSchema: { requestId: z.string().uuid() },
    annotations: { readOnlyHint: true }
  }, async ({ requestId }) => {
    const fact = `Workspace fact ${requestId} is ${randomBytes(16).toString("hex")}.`;
    await appendFile(receipt, JSON.stringify({ requestId, fact, transport }) + "\n", { mode: 0o600 });
    return { content: [{ type: "text", text: fact }] };
  });
  return { server, fromSdk };
}

async function startHttpMcpFixture(sdkRoot, receipt) {
  const http = createServer(async (request, response) => {
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    const { server, fromSdk } = createMcpServer(sdkRoot, receipt, "http");
    const { StreamableHTTPServerTransport } = fromSdk("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.once("close", () => void server.close());
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve, reject) => http.listen(0, "127.0.0.1", resolve).once("error", reject));
  return {
    url: "http://127.0.0.1:" + http.address().port + "/mcp",
    close: () => new Promise(resolve => {
      http.close(resolve);
      http.closeAllConnections();
    })
  };
}

if (require.main === module) {
  const [, , sdkRoot, receipt] = process.argv;
  const { server, fromSdk } = createMcpServer(sdkRoot, receipt, "stdio");
  const { StdioServerTransport } = fromSdk("@modelcontextprotocol/sdk/server/stdio.js");
  void server.connect(new StdioServerTransport());
}

module.exports = { startHttpMcpFixture };
