import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const describeServiceSchema = {
  name: "describe_service",
  description: "Describe a Kubernetes service (read details like status, ports, selectors, etc.)",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string", default: "default" },
    },
    required: ["name"],
  },
} as const;

export async function describeService(k8sManager: KubernetesManager, input: {
  name: string;
  namespace?: string;
}) {
  const namespace = input.namespace || "default";
  
  try {
    const { body } = await k8sManager.getCoreApi().readNamespacedService(
      input.name,
      namespace
    );

    if (!body) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Service not found",
                status: "not_found",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    // Format service details for better readability
    const serviceDetails = {
      kind: body.kind,
      metadata: {
        name: body.metadata?.name,
        namespace: body.metadata?.namespace,
        creationTimestamp: body.metadata?.creationTimestamp,
        labels: body.metadata?.labels,
      },
      spec: {
        type: body.spec?.type,
        selector: body.spec?.selector,
        ports: body.spec?.ports?.map((port: k8s.V1ServicePort) => ({
          name: port.name,
          protocol: port.protocol,
          port: port.port,
          targetPort: port.targetPort,
          nodePort: port.nodePort,
        })),
        clusterIP: body.spec?.clusterIP,
        externalIPs: body.spec?.externalIPs,
        loadBalancerIP: body.spec?.loadBalancerIP,
      },
      status: {
        loadBalancer: body.status?.loadBalancer,
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(serviceDetails, null, 2),
        },
      ],
    };
  } catch (error: any) {
    if (error.response?.statusCode === 404) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Service not found",
                status: "not_found",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to describe service: ${error.response?.body?.message || error.message}`
    );
  }
} 