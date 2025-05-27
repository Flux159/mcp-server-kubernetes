import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const describePodSchema = {
  name: "describe_pod",
  description: "Describe a Kubernetes pod (read details like status, containers, etc.)",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string" },
    },
    required: ["name", "namespace"],
  },
} as const;

export async function describePod(k8sManager: KubernetesManager, input: {
  name: string;
  namespace: string;
}) {
  try {
    const { body } = await k8sManager.getCoreApi().readNamespacedPod(
      input.name,
      input.namespace
    );

    if (!body) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Pod not found",
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

    // Format the pod details for better readability
    const podDetails = {
      kind: body.kind,
      metadata: {
        name: body.metadata?.name,
        namespace: body.metadata?.namespace,
        creationTimestamp: body.metadata?.creationTimestamp,
        labels: body.metadata?.labels,
      },
      spec: {
        containers: body.spec?.containers.map((container: k8s.V1Container) => ({
          name: container.name,
          image: container.image,
          ports: container.ports,
          resources: container.resources,
        })),
        nodeName: body.spec?.nodeName,
      },
      status: {
        phase: body.status?.phase,
        conditions: body.status?.conditions,
        containerStatuses: body.status?.containerStatuses,
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(podDetails, null, 2),
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
                error: "Pod not found",
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
      `Failed to describe pod: ${error.response?.body?.message || error.message}`
    );
  }
}
