import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const updateServiceSchema = {
  name: "update_service",
  description: "Update an existing kubernetes service in cluster",
  inputSchema: {
    type: "object",
    required: ["name", "namespace"],
    properties: {
      name: { type: "string" },
      namespace: { type: "string", default: "default" },
      type: {
        type: "string",
        enum: ["ClusterIP", "NodePort", "LoadBalancer"],
      },
      selector: {
        type: "object",
        additionalProperties: { type: "string" },
      },
      ports: {
        type: "array",
        items: {
          type: "object",
          properties: {
            port: { type: "number" },
            targetPort: { type: "number" },
            protocol: {
              type: "string",
              enum: ["TCP", "UDP"],
              default: "TCP"
            },
            name: { type: "string" },
            nodePort: { type: "number" }
          },
          required: ["port"]
        }
      }
    },
  },
};

export async function updateService(
  k8sManager: KubernetesManager,
  params: {
    name: string;
    namespace: string;
    type?: "ClusterIP" | "NodePort" | "LoadBalancer";
    selector?: Record<string, string>;
    ports?: Array<{
      port: number;
      targetPort?: number;
      protocol?: string;
      name?: string;
      nodePort?: number;
    }>;
  }
) {
  // Get existing service
  const { body: existingService } = await k8sManager
    .getCoreApi()
    .readNamespacedService(params.name, params.namespace)
    .catch((error: any) => {
      console.error("Service read error:", {
        status: error.response?.statusCode,
        message: error.response?.body?.message || error.message,
        details: error.response?.body,
      });
      
      if (error.response?.statusCode === 404) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Service '${params.name}' not found in namespace '${params.namespace}'`
        );
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve service: ${error.response?.body?.message || error.message}`
      );
    });

  // Process ports if provided
  let servicePorts: k8s.V1ServicePort[] | undefined;
  if (params.ports) {
    servicePorts = params.ports.map((portConfig, index) => {
      const existingPort = existingService.spec?.ports?.[index];
      const name = portConfig.name || (existingPort?.name || `port-${index}`);
      
      return {
        port: portConfig.port,
        targetPort: portConfig.targetPort !== undefined 
          ? portConfig.targetPort 
          : portConfig.port,
        protocol: portConfig.protocol || "TCP",
        name: name,
        ...(existingService.spec?.type === "NodePort" || params.type === "NodePort" ? 
          { nodePort: portConfig.nodePort !== undefined ? portConfig.nodePort : existingPort?.nodePort } : {})
      };
    });
  }

  const updatedService: k8s.V1Service = {
    ...existingService,
    spec: {
      ...existingService.spec!,
      type: params.type || existingService.spec!.type,
      selector: params.selector || existingService.spec!.selector,
      ports: servicePorts || existingService.spec!.ports,
      clusterIP: existingService.spec!.clusterIP,
    },
  };

  try {
    const { body } = await k8sManager
      .getCoreApi()
      .replaceNamespacedService(params.name, params.namespace, updatedService);
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: "Service updated successfully",
              service: {
                name: body.metadata?.name,
                namespace: body.metadata?.namespace,
                type: body.spec?.type,
                clusterIP: body.spec?.clusterIP,
                ports: body.spec?.ports,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    console.error("Service update error:", {
      status: error.response?.statusCode,
      message: error.response?.body?.message || error.message,
      details: error.response?.body,
    });
    
    if (error instanceof McpError) throw error;
    
    // Handle specific Kubernetes API errors
    if (error.response?.body?.message) {
      if (error.response.body.message.includes("field is immutable")) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Update failed: Attempted to modify immutable field. ${error.response.body.message}`
        );
      }
      
      if (error.response.statusCode === 422) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Invalid service configuration: ${error.response.body.message}`
        );
      }
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to update service: ${error.response?.body?.message || error.message}`
    );
  }
} 