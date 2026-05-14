import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";
import { createAuthMiddleware, isAuthEnabled } from "./auth.js";

/**
 * Build the default allowedHosts list for DNS rebinding protection.
 * Includes localhost variants with and without port.
 */
function buildDefaultAllowedHosts(host: string, port: number): string[] {
  // Always allow the bare host and host:port for common localhost addresses
  const localhostAliases = ["127.0.0.1", "localhost", "::1"];
  const hosts: string[] = [];
  for (const alias of localhostAliases) {
    hosts.push(alias);
    hosts.push(`${alias}:${port}`);
  }
  // Also add the configured host if it's not already covered
  if (!localhostAliases.includes(host)) {
    hosts.push(host);
    hosts.push(`${host}:${port}`);
  }
  return hosts;
}

export function startStreamableHTTPServer(server: Server): http.Server {
  const app = express();
  app.use(express.json());

  // Create auth middleware - when MCP_AUTH_TOKEN is set, requires X-MCP-AUTH header
  const authMiddleware = createAuthMiddleware();

  // DNS rebinding protection is enabled by default. Set DNS_REBINDING_PROTECTION=false to disable.
  const enableDnsRebindingProtection =
    process.env.DNS_REBINDING_PROTECTION !== "false";

  const host = process.env.HOST || "localhost";

  let port = 3000;
  try {
    port = parseInt(process.env.PORT || "3000", 10);
  } catch (e) {
    console.error(
      "Invalid PORT environment variable, using default port 3000."
    );
  }

  const allowedHosts = process.env.DNS_REBINDING_ALLOWED_HOST
    ? [process.env.DNS_REBINDING_ALLOWED_HOST]
    : buildDefaultAllowedHosts(host, port);

  // Warn when binding to all interfaces with DNS rebinding protection disabled
  if (!enableDnsRebindingProtection && (host === "0.0.0.0" || host === "::")) {
    console.warn(
      "WARNING: DNS rebinding protection is disabled while HOST is set to " +
        `'${host}'. This exposes the MCP server to DNS rebinding attacks ` +
        "from any browser on the network. Set DNS_REBINDING_PROTECTION=true " +
        "(the default) or restrict HOST to 'localhost' / '127.0.0.1'."
    );
  }

  app.post("/mcp", authMiddleware, async (req: express.Request, res: express.Response) => {
    // In stateless mode, create a new instance of transport and server for each request
    // to ensure complete isolation. A single instance would cause request ID collisions
    // when multiple clients connect concurrently.

    try {
      const transport: StreamableHTTPServerTransport =
        new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableDnsRebindingProtection,
          allowedHosts,
        });
      res.on("close", () => {
        transport.close();
        // Note: server.close() should NOT be called here as server is shared
        // across all requests. Calling it would close the global MCP Server
        // instance and cause the Node.js process to exit. Only the transport
        // instance needs to be closed when the HTTP connection ends.
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  // SSE notifications not supported in stateless mode
  app.get("/mcp", authMiddleware, async (req: express.Request, res: express.Response) => {
    console.log("Received GET MCP request");
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      })
    );
  });

  // Session termination not needed in stateless mode
  app.delete("/mcp", authMiddleware, async (req: express.Request, res: express.Response) => {
    console.log("Received DELETE MCP request");
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      })
    );
  });

  app.get("/health", async (req: express.Request, res: express.Response) => {
    res.json({ status: "ok" });
  });

  app.get("/ready", async (req: express.Request, res: express.Response) => {
    try {
      // We can add more checks if required
      // For now, we'll consider the server ready if it can respond to this request
      res.json({
        status: "ready",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Readiness check failed:", error);
      res.status(503).json({
        status: "not ready",
        reason: "Server initialization incomplete",
        timestamp: new Date().toISOString()
      });
    }
  });

  const httpServer = app.listen(port, host, () => {
    console.log(
      `mcp-kubernetes-server is listening on port ${port}\nUse the following url to connect to the server:\nhttp://${host}:${port}/mcp`
    );
    if (isAuthEnabled()) {
      console.log(
        "Authentication enabled: X-MCP-AUTH header required for all MCP requests"
      );
    }
  });
  return httpServer;
}
