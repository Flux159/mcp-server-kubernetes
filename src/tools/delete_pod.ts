import { KubernetesManager } from "../types.js";

export const deletePodSchema = {
  name: "delete_pod",
  description: "Delete a Kubernetes pod",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string" },
      ignoreNotFound: { type: "boolean", default: false },
    },
    required: ["name", "namespace"],
  },
} as const;

export async function deletePod(k8sManager: KubernetesManager, input: {
  name: string;
  namespace: string;
  ignoreNotFound?: boolean;
}) {
  try {
    await k8sManager.getCoreApi().deleteNamespacedPod(input.name, input.namespace);
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
