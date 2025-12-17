// authConfig.ts
import dotenv from "dotenv";
dotenv.config();

export interface OAuthMetadata {
    resource: string;
    authorization_servers: string[];
    bearer_methods_supported?: string[];
    resource_documentation?: string;
    scopes_supported?: string[];
}

export interface ScalekitSettings {
    enableAuth: boolean;
    scalekitEnvironmentUrl: string;
    scalekitClientId: string;
    scalekitClientSecret: string;
    metadataJsonResponse: string;
    resourceName: string;
    audienceName: string[];
    resourceDocumentation?: string;
    port: number;
    host: string;
    resourceMetadataUrl?: string;
    authorizationServers: string[];
}

/**
 * Load Scalekit authentication configuration from environment variables
 */
export function loadScalekitSettings(): ScalekitSettings {
    return {
        enableAuth: process.env.ENABLE_AUTH === "true",
        scalekitEnvironmentUrl: process.env.SCALEKIT_ENVIRONMENT_URL || "",
        scalekitClientId: process.env.SCALEKIT_CLIENT_ID || "",
        scalekitClientSecret: process.env.SCALEKIT_CLIENT_SECRET || "",
        metadataJsonResponse: process.env.METADATA_JSON_RESPONSE || "",
        resourceName: process.env.RESOURCE_NAME || "mcp-kubernetes-server",
        audienceName: (process.env.SCALEKIT_AUDIENCE_NAME || "").split(",").map(s => s.trim()),
        resourceDocumentation: process.env.RESOURCE_DOCUMENTATION,
        port: parseInt(process.env.PORT || "3000", 10),
        host: process.env.HOST || "localhost",
        resourceMetadataUrl:
            process.env.SCALEKIT_RESOURCE_METADATA_URL ||
            `http://${process.env.HOST || "localhost"}:${process.env.PORT || 3000}/.well-known/oauth-protected-resource/mcp`,
        authorizationServers: (process.env.SCALEKIT_AUTHORIZATION_SERVERS || "")
            .split(",")
            .map(s => s.trim())
            .filter(s => s.length > 0),
    };
}

/**
 * Get OAuth 2.0 Protected Resource Metadata from Scalekit configuration
 */
export function getOAuthMetadata(settings: ScalekitSettings): OAuthMetadata {
    // If metadata JSON is provided from Scalekit, parse and return it
    if (settings.metadataJsonResponse) {
        try {
            return JSON.parse(settings.metadataJsonResponse);
        } catch (error) {
            console.error("Failed to parse METADATA_JSON_RESPONSE:", error);
        }
    }

    // Fallback: construct metadata manually
    return {
        resource:
            settings.audienceName[0] || `http://${settings.host}:${settings.port}/mcp`,
        authorization_servers: settings.authorizationServers.length > 0
            ? settings.authorizationServers
            : settings.scalekitEnvironmentUrl
                ? [settings.scalekitEnvironmentUrl]
                : [],
        bearer_methods_supported: ["header"],
        resource_documentation: settings.resourceDocumentation,
        scopes_supported: [
            "mcp:tools:*",
            "mcp:resources:*",
            "mcp:tools:kubectl:read",
            "mcp:tools:kubectl:write",
            "mcp:tools:helm:*",
        ],
    };
}

