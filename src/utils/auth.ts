// auth.ts
import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import { ScalekitClient } from "@scalekit-sdk/node";
import { getOAuthMetadata, loadScalekitSettings, ScalekitSettings } from "./authConfig.js";
import {
    extractBearerToken,
    sendUnauthorized,
    mapClaimsToUser,
    validateScalekitSettings,
    shouldSkipAuth,
} from "./auth-utils.js";

// --------------------
// Types
// --------------------
export interface AuthenticatedUser {
    sub: string;
    email?: string;
    roles: string[];
    isUserToken: boolean;
    [key: string]: any;
}

// Extend Express.Request to include 'user'
declare global {
    namespace Express {
        interface Request {
            user?: AuthenticatedUser;
        }
    }
}

// --------------------
// Load and validate settings
// --------------------
const settings: ScalekitSettings = loadScalekitSettings();
validateScalekitSettings(settings);

// Initialize Scalekit client
const scalekit = new ScalekitClient(
    settings.scalekitEnvironmentUrl,
    settings.scalekitClientId,
    settings.scalekitClientSecret
);

// --------------------
// Middleware
// --------------------
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    if (shouldSkipAuth(req.path)) return next();
    if (!settings.enableAuth) return next();

    const token = extractBearerToken(req);
    if (!token) return sendUnauthorized(res, settings, "Missing or invalid authorization header");

    try {
        console.info("[Auth] Validating token for path:", req.path);

        // Validate token against expected audience
        await scalekit.validateAccessToken(token, { audience: settings.audienceName });

        // Fetch full claims
        const claims = await scalekit.getIdpInitiatedLoginClaims(token) as Record<string, any>;

        // Map claims to AuthenticatedUser
        req.user = mapClaimsToUser(claims);

        console.info("[Auth] Token validated. User:", req.user);
        next();
    } catch (err: any) {
        console.error("[Auth] Token validation failed:", err.message || err);
        sendUnauthorized(res, settings, `Token validation failed: ${err.message}`);
    }
}

// --------------------
// Metadata Endpoint
// --------------------
export function mountAuth(app: express.Express) {
    app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
        const md = getOAuthMetadata(settings);
        console.info("[Auth] Serving OAuth metadata:", JSON.stringify(md, null, 2));
        res.json(md);
    });
}

export { scalekit };
