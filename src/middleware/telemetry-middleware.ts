import { trace, context, SpanStatusCode, Span } from "@opentelemetry/api";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getTelemetryConfig } from "../config/telemetry-config.js";

/**
 * Telemetry middleware for MCP tool call tracing
 * Wraps tool handlers with OpenTelemetry spans to provide automatic instrumentation
 */

// Get tracer instance
const tracer = trace.getTracer("mcp-server-kubernetes", "0.1.0");

/**
 * Tool call handler function type
 */
type ToolCallHandler = (request: {
  params: { name: string; _meta?: any; arguments?: Record<string, any> };
  method: string;
}) => Promise<any>;

/**
 * Wrap a tool call handler with OpenTelemetry tracing
 * Creates a span for each tool invocation with detailed attributes
 *
 * @param handler - The original tool call handler function
 * @returns Wrapped handler with tracing instrumentation
 */
export function withTelemetry(handler: ToolCallHandler): ToolCallHandler {
  return async (request) => {
    const { name: toolName, arguments: args } = request.params;

    // Create span for this tool call
    return await tracer.startActiveSpan(
      `tools/call ${toolName}`,
      {
        attributes: {
          "mcp.method.name": "tools/call",
          "gen_ai.tool.name": toolName,
          "gen_ai.operation.name": "execute_tool",
          "network.transport": "pipe", // STDIO mode
        },
      },
      async (span: Span) => {
        const startTime = Date.now();

        try {
          // Add argument metadata (safely, without exposing sensitive data)
          if (args) {
            const argKeys = Object.keys(args);
            span.setAttribute("tool.argument_count", argKeys.length);
            span.setAttribute("tool.argument_keys", argKeys.join(","));

            // Add specific attributes for common arguments
            if (args.context) {
              span.setAttribute("k8s.context", args.context);
            }
            if (args.namespace) {
              span.setAttribute("k8s.namespace", args.namespace);
            }
            if (args.resourceType) {
              span.setAttribute("k8s.resource_type", args.resourceType);
            }
          }

          // Execute the actual tool handler
          const result = await handler(request);

          // Record success
          const duration = Date.now() - startTime;
          span.setAttribute("tool.duration_ms", duration);
          span.setStatus({ code: SpanStatusCode.OK });

          // Capture response metadata (not the actual data)
          // Can be disabled with OTEL_CAPTURE_RESPONSE_METADATA=false for privacy
          const telemetryConfig = getTelemetryConfig();
          if (result && telemetryConfig.captureResponseMetadata) {
            // Check if result has content array (MCP response format)
            if (result.content && Array.isArray(result.content)) {
              span.setAttribute("response.content_items", result.content.length);

              // Get the first content item to analyze
              if (result.content.length > 0) {
                const firstItem = result.content[0];
                span.setAttribute("response.content_type", firstItem.type || "unknown");

                // If it's text content, capture size and maybe a snippet
                if (firstItem.type === "text" && firstItem.text) {
                  const textSize = firstItem.text.length;
                  span.setAttribute("response.text_size_bytes", textSize);

                  // Try to parse JSON and get item count
                  try {
                    const parsed = JSON.parse(firstItem.text);

                    // Check for Kubernetes list response
                    if (parsed.items && Array.isArray(parsed.items)) {
                      span.setAttribute("response.k8s_items_count", parsed.items.length);
                      span.setAttribute("response.k8s_kind", parsed.kind || "unknown");
                    }

                    // Check for MCP list response
                    if (Array.isArray(parsed)) {
                      span.setAttribute("response.items_count", parsed.length);
                    }

                    // Capture if response indicates success
                    if (parsed.success !== undefined) {
                      span.setAttribute("response.success", parsed.success);
                    }
                  } catch (e) {
                    // Not JSON, that's fine - just capture text size
                  }
                }
              }
            }

            // Check for direct success indicators
            if (typeof result.success === "boolean") {
              span.setAttribute("response.success", result.success);
            }
          }

          return result;
        } catch (error: any) {
          // Record failure
          const duration = Date.now() - startTime;
          span.setAttribute("tool.duration_ms", duration);
          span.setAttribute("error.type", "tool_error");

          if (error.message) {
            span.setAttribute("error.message", error.message);
          }

          if (error.code) {
            span.setAttribute("error.code", error.code);
          }

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message || "Tool execution failed",
          });

          // Re-throw to maintain original error behavior
          throw error;
        } finally {
          span.end();
        }
      }
    );
  };
}

/**
 * Create a manual span for non-tool operations
 * Useful for tracing other server operations outside of tool calls
 *
 * @param name - Span name
 * @param fn - Function to execute within the span
 * @returns Result of the function
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>
): Promise<T> {
  return await tracer.startActiveSpan(name, { attributes }, async (span: Span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.setAttribute("error.type", "operation_error");
      if (error.message) {
        span.setAttribute("error.message", error.message);
      }
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message || "Operation failed",
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Add custom attributes to the current active span
 * Useful for adding context during tool execution
 *
 * @param attributes - Key-value pairs to add to the span
 */
export function addSpanAttributes(attributes: Record<string, string | number | boolean>) {
  const currentSpan = trace.getActiveSpan();
  if (currentSpan) {
    for (const [key, value] of Object.entries(attributes)) {
      currentSpan.setAttribute(key, value);
    }
  }
}

/**
 * Record an event on the current active span
 * Useful for tracking significant moments during tool execution
 *
 * @param name - Event name
 * @param attributes - Optional event attributes
 */
export function recordSpanEvent(name: string, attributes?: Record<string, string | number | boolean>) {
  const currentSpan = trace.getActiveSpan();
  if (currentSpan) {
    currentSpan.addEvent(name, attributes);
  }
}
