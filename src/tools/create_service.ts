import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const createServiceSchema = {
  name: "create_service",
  description: "Create a new Kubernetes service",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string", default: "default" },
      type: {
        type: "string",
        enum: ["ClusterIP", "NodePort", "LoadBalancer"],
        default: "ClusterIP"
      },
      selector: {
        type: "object",
        additionalProperties: { type: "string" },
        default: {}
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
    required: ["name", "ports"],
  },
} as const;

export async function createService(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace?: string;
    type?: "ClusterIP" | "NodePort" | "LoadBalancer";
    selector?: Record<string, string>;
    ports: Array<{
      port: number;
      targetPort?: number;
      protocol?: string;
      name?: string;
      nodePort?: number;
    }>;
  }
) {
  const namespace = input.namespace || "default";
  const serviceType = input.type || "ClusterIP";

  // Convert ports to k8s.V1ServicePort format
  const servicePorts: k8s.V1ServicePort[] = input.ports.map((portConfig, index) => {
    return {
      port: portConfig.port,
      targetPort: portConfig.targetPort !== undefined ? portConfig.targetPort : portConfig.port,
      protocol: portConfig.protocol || "TCP",
      name: portConfig.name || `port-${index}`,
      ...(serviceType === "NodePort" && portConfig.nodePort ? { nodePort: portConfig.nodePort } : {})
    };
  });

  // Default selector
  const selector = input.selector || { app: input.name };

  const service: k8s.V1Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: input.name,
      namespace: namespace,
      labels: {
        "mcp-managed": "true",
        app: input.name,
      },
    },
    spec: {
      type: serviceType,
      selector: selector,
      ports: servicePorts
    }
  };

  try {
    const response = await k8sManager
      .getCoreApi()
      .createNamespacedService(namespace, service);

    k8sManager.trackResource("Service", input.name, namespace);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              serviceName: response.body.metadata!.name!,
              namespace: response.body.metadata!.namespace!,
              type: response.body.spec!.type,
              clusterIP: response.body.spec!.clusterIP,
              ports: response.body.spec!.ports,
              status: "created",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    console.error("Service creation error:", {
      status: error.response?.statusCode,
      message: error.response?.body?.message || error.message,
      details: error.response?.body,
    });
    throw error;
  }
}