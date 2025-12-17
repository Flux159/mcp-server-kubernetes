import { Response } from "express";
import { ScalekitSettings } from "./authConfig.js";

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(req: { headers: Record<string, any> }): string | null {
    const header = req.headers["authorization"] || "";
    return header.startsWith("Bearer ") ? header.substring("Bearer ".length) : null;
}

/**
 * Send unauthorized error response with OAuth metadata
 */
export function sendUnauthorized(
    res: Response,
    settings: ScalekitSettings,
    detail?: string
): void {
    res.setHeader(
        "WWW-Authenticate",
        `Bearer realm="OAuth", resource_metadata="${settings.resourceMetadataUrl}"`
    );
    res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: detail || "Unauthorized" },
        id: null,
    });
}

/**
 * Send error response in JSON-RPC format
 */
export function sendJsonRpcError(
    res: Response,
    code: number,
    message: string,
    statusCode: number = 400
): void {
    res.status(statusCode).json({
        jsonrpc: "2.0",
        error: { code, message },
        id: null,
    });
}

/**
 * Map raw claims from Scalekit token to AuthenticatedUser
 * Ensures 'sub' is present and roles are set properly
 */
export function mapClaimsToUser(claims: Record<string, any>): any {
    if (!claims.sub || typeof claims.sub !== "string") {
        throw new Error("Invalid token claims: missing 'sub'");
    }

    const isUserToken = claims.sub.startsWith("usr_");

    return {
        sub: claims.sub,
        email: claims.email,
        isUserToken,
        roles: claims.roles || (isUserToken ? [] : ["mcp"]),
        ...claims,
    };
}

/**
 * Validate required Scalekit settings
 */
export function validateScalekitSettings(settings: ScalekitSettings): void {
    const required: (keyof ScalekitSettings)[] = [
        "scalekitEnvironmentUrl",
        "scalekitClientId",
        "scalekitClientSecret",
    ];
    for (const key of required) {
        if (!settings[key]) {
            throw new Error(`[Auth] Missing required environment variable: ${key}`);
        }
    }
}

/**
 * Check if request should skip authentication
 */
export function shouldSkipAuth(path: string): boolean {
    return path.startsWith("/.well-known/") || path === "/health" || path === "/ready";
}
