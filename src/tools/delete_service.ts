import { KubernetesManager } from "../types.js";

export const deleteServiceSchema = {
  name: "delete_service",
  description: "Delete a Kubernetes service",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string", default: "default" },
      ignoreNotFound: { type: "boolean", default: false },
    },
    required: ["name"],
  },
} as const;

export async function deleteService(k8sManager: KubernetesManager, input: {
  name: string;
  namespace?: string;
  ignoreNotFound?: boolean;
}) {
  const namespace = input.namespace || "default";
  
  try {
    await k8sManager.getCoreApi().deleteNamespacedService(input.name, namespace);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              status: "deleted",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    if (input.ignoreNotFound && error.response?.statusCode === 404) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                status: "not_found",
              },
              null,
              2
            ),
          },
        ],
      };
    }
    throw error;
  }
} 