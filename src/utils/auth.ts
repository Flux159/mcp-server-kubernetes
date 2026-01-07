import { Request, Response, NextFunction } from "express";

/**
 * Authentication middleware for MCP HTTP transports.
 *
 * When the MCP_AUTH_TOKEN environment variable is set, this middleware
 * requires all requests to include a matching X-MCP-AUTH header.
 *
 * This provides a simple authentication mechanism for securing MCP endpoints
 * in cluster environments where full OAuth may be overkill.
 *
 * Example usage:
 *   Server: MCP_AUTH_TOKEN=my-secret-token
 *   Client: X-MCP-AUTH: my-secret-token
 */
export function createAuthMiddleware() {
  const authToken = process.env.MCP_AUTH_TOKEN;

  return (req: Request, res: Response, next: NextFunction): void => {
    // If no auth token is configured, allow all requests
    if (!authToken) {
      next();
      return;
    }

    const providedToken = req.headers["x-mcp-auth"];

    if (!providedToken) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized: X-MCP-AUTH header is required",
        },
        id: null,
      });
      return;
    }

    if (providedToken !== authToken) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32002,
          message: "Forbidden: Invalid authentication token",
        },
        id: null,
      });
      return;
    }

    next();
  };
}

/**
 * Returns whether authentication is enabled (MCP_AUTH_TOKEN is set)
 */
export function isAuthEnabled(): boolean {
  return !!process.env.MCP_AUTH_TOKEN;
}
