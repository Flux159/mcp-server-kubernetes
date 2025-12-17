import express, { Request, Response, NextFunction } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";
import { authMiddleware, mountAuth } from "./auth.js";
import { loadScalekitSettings } from "./authConfig.js";
import { sendJsonRpcError } from "./auth-utils.js";

const settings = loadScalekitSettings();

// Extend Express Request type to include `user` added by authMiddleware
export interface AuthenticatedRequest extends Request {
  user?: any;
}

export function startStreamableHTTPServer(server: Server): http.Server {
  const app = express();

  // IMPORTANT: Enable strict routing to handle trailing slashes properly
  // This ensures /mcp and /mcp/ are treated as the same route
  app.set("strict routing", false);

  // Use built-in JSON parser with a limit
  app.use(express.json({ limit: "5mb" }));

  // Request logging
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Mount the OAuth2 Resource Metadata endpoint BEFORE auth middleware
  mountAuth(app);

  // Health endpoints (before auth middleware)
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get("/ready", (_req: Request, res: Response) => {
    res.json({
      status: "ready",
      timestamp: new Date().toISOString(),
      auth: {
        enabled: settings.enableAuth,
        provider: "scalekit",
        audience: settings.audienceName,
      },
    });
  });

  // Shared MCP request handler
  const handleMcpRequest = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    console.log("[MCP] Processing MCP request");
    console.log("[MCP] Path:", req.path);
    console.log("[MCP] User:", req.user ? "authenticated" : "NOT authenticated");

    try {
      // Double-check authentication (should be guaranteed by middleware)
      if (settings.enableAuth && !req.user) {
        console.error("[MCP] Auth enabled but no user found after middleware!");
        sendJsonRpcError(res, -32600, "Unauthorized: missing or invalid token", 401);
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: process.env.DNS_REBINDING_PROTECTION === "true",
        allowedHosts: process.env.DNS_REBINDING_ALLOWED_HOST
          ? [process.env.DNS_REBINDING_ALLOWED_HOST]
          : ["127.0.0.1"],
      });

      res.on("close", () => {
        try {
          transport.close();
        } catch (err) {
          console.error("[MCP] Error closing transport:", err);
        }
      });

      await server.connect(transport);

      // Attach authenticated user info to request metadata
      if (!req.body) req.body = {};
      if (!req.body.params) req.body.params = {};
      req.body.params._meta = {
        ...(req.body.params._meta || {}),
        user: req.user,
      };

      console.log("[MCP] Handling request with transport");
      await transport.handleRequest(req, res, req.body);
      console.log("[MCP] Request handled successfully");
    } catch (err) {
      console.error("[MCP] Transport error:", err);
      if (!res.headersSent) {
        sendJsonRpcError(res, -32603, "Internal server error", 500);
      }
    }
  };

  // Build middleware array conditionally based on auth setting
  const middlewares = settings.enableAuth
    ? [authMiddleware as unknown as express.RequestHandler]
    : [];

  // Register both /mcp and /mcp/ routes with optional auth
  app.post("/mcp", ...middlewares, handleMcpRequest);
  app.post("/mcp/", ...middlewares, handleMcpRequest);

  // Reject unsupported methods for both /mcp and /mcp/
  const rejectMethod = (_req: Request, res: Response): void => {
    sendJsonRpcError(res, -32000, "Method not allowed.", 405);
  };

  app.get("/mcp", rejectMethod);
  app.get("/mcp/", rejectMethod);
  app.delete("/mcp", rejectMethod);
  app.delete("/mcp/", rejectMethod);

  // Start the HTTP server
  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "localhost";
  const httpServer = app.listen(port, host, () => {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 Kubernetes MCP Server Started");
    console.log("=".repeat(60));
    console.log(`📍 URL: http://${host}:${port}/mcp`);
    console.log(`📍 URL (alt): http://${host}:${port}/mcp/`);
    console.log(`🔒 Authentication: ${settings.enableAuth ? "ENABLED (Scalekit)" : "DISABLED"}`);

    if (settings.enableAuth) {
      console.log(`🔑 Scalekit Environment: ${settings.scalekitEnvironmentUrl}`);
      console.log(`👥 Audience: ${settings.audienceName.join(", ")}`);
      console.log(
        `📄 OAuth Metadata: http://${host}:${port}/.well-known/oauth-protected-resource/mcp`
      );
    }

    console.log(`💚 Health Check: http://${host}:${port}/health`);
    console.log(`✅ Ready Check: http://${host}:${port}/ready`);
    console.log("\n✅ Both /mcp and /mcp/ endpoints are registered");
    console.log("=".repeat(60) + "\n");
  });

  return httpServer;
}
