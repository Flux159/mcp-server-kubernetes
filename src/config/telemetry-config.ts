import { NodeSDK, resources } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { serverConfig } from "./server-config.js";

/**
 * Telemetry configuration for OpenTelemetry integration
 * Supports environment variable configuration for flexible deployment
 */
export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  serviceName: string;
  serviceVersion: string;
  resourceAttributes: Record<string, string>;
  sampler?: {
    type: "always_on" | "always_off" | "traceidratio";
    arg?: number;
  };
  captureResponseMetadata: boolean; // NEW: Control response metadata capture
}

/**
 * Parse OpenTelemetry sampling configuration from environment variables
 */
function parseSamplerConfig(): TelemetryConfig["sampler"] | undefined {
  const samplerType = process.env.OTEL_TRACES_SAMPLER;
  const samplerArg = process.env.OTEL_TRACES_SAMPLER_ARG;

  if (!samplerType) {
    return undefined;
  }

  const config: TelemetryConfig["sampler"] = {
    type: samplerType as any,
  };

  if (samplerArg && (samplerType === "traceidratio" || samplerType.includes("traceidratio"))) {
    const arg = parseFloat(samplerArg);
    if (!isNaN(arg) && arg >= 0 && arg <= 1) {
      config.arg = arg;
    }
  }

  return config;
}

/**
 * Parse resource attributes from environment variable
 * Format: "key1=value1,key2=value2"
 */
function parseResourceAttributes(): Record<string, string> {
  const attrs: Record<string, string> = {};
  const envAttrs = process.env.OTEL_RESOURCE_ATTRIBUTES;

  if (envAttrs) {
    const pairs = envAttrs.split(",");
    for (const pair of pairs) {
      const [key, value] = pair.split("=").map((s) => s.trim());
      if (key && value) {
        attrs[key] = value;
      }
    }
  }

  return attrs;
}

/**
 * Get telemetry configuration from environment variables
 */
export function getTelemetryConfig(): TelemetryConfig {
  // Check if telemetry is explicitly enabled (opt-in)
  const enableFlag = process.env.ENABLE_TELEMETRY;
  const isExplicitlyEnabled = enableFlag === "true" || enableFlag === "1";

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  // Telemetry is enabled only if:
  // 1. ENABLE_TELEMETRY=true is set, AND
  // 2. OTEL_EXPORTER_OTLP_ENDPOINT is configured
  const enabled = isExplicitlyEnabled && !!endpoint;

  // Check if response metadata capture is enabled (default: true)
  const captureResponseEnv = process.env.OTEL_CAPTURE_RESPONSE_METADATA;
  const captureResponseMetadata = captureResponseEnv !== "false" && captureResponseEnv !== "0";

  return {
    enabled,
    endpoint,
    serviceName: process.env.OTEL_SERVICE_NAME || serverConfig.name,
    serviceVersion: process.env.OTEL_SERVICE_VERSION || serverConfig.version,
    resourceAttributes: parseResourceAttributes(),
    sampler: parseSamplerConfig(),
    captureResponseMetadata, // Enabled by default, can be disabled with OTEL_CAPTURE_RESPONSE_METADATA=false
  };
}

/**
 * Initialize OpenTelemetry SDK with configuration
 * Call this before starting the MCP server
 */
export function initializeTelemetry(): NodeSDK | null {
  const config = getTelemetryConfig();

  if (!config.enabled) {
    const enableFlag = process.env.ENABLE_TELEMETRY;
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    if (!enableFlag || enableFlag === "false" || enableFlag === "0") {
      // Observability is disabled by default
      return null;
    } else if (!endpoint) {
      console.error("OpenTelemetry: ENABLE_TELEMETRY=true but OTEL_EXPORTER_OTLP_ENDPOINT not set");
      return null;
    }
    return null;
  }

  console.error(
    `Initializing OpenTelemetry: endpoint=${config.endpoint}, service=${config.serviceName}`
  );

  // Create OTLP trace exporter
  const traceExporter = new OTLPTraceExporter({
    url: config.endpoint,
  });

  // Create resource with service metadata
  const defaultRes = resources.defaultResource();
  const customRes = resources.resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: config.serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: config.serviceVersion,
    ...config.resourceAttributes,
  });
  const resource = defaultRes.merge(customRes);

  // Initialize Node SDK
  const sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable some instrumentations that may be too verbose
        "@opentelemetry/instrumentation-fs": {
          enabled: false,
        },
      }),
    ],
  });

  try {
    sdk.start();
    console.error("OpenTelemetry SDK initialized successfully");

    // Graceful shutdown on process termination
    process.on("SIGTERM", async () => {
      try {
        await sdk.shutdown();
        console.error("OpenTelemetry SDK shut down successfully");
      } catch (error) {
        console.error("Error shutting down OpenTelemetry SDK:", error);
      }
    });

    return sdk;
  } catch (error) {
    console.error("Failed to initialize OpenTelemetry SDK:", error);
    return null;
  }
}

/**
 * Get telemetry configuration summary for logging
 */
export function getTelemetryConfigSummary(): string {
  const config = getTelemetryConfig();

  if (!config.enabled) {
    return "Telemetry: Disabled";
  }

  const parts = [
    `Telemetry: Enabled`,
    `Endpoint: ${config.endpoint}`,
    `Service: ${config.serviceName}@${config.serviceVersion}`,
  ];

  if (config.sampler) {
    parts.push(`Sampler: ${config.sampler.type}${config.sampler.arg !== undefined ? `(${config.sampler.arg})` : ""}`);
  }

  const attrCount = Object.keys(config.resourceAttributes).length;
  if (attrCount > 0) {
    parts.push(`Resource Attributes: ${attrCount}`);
  }

  return parts.join(", ");
}
