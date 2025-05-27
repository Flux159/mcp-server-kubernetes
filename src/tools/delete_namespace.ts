import { KubernetesManager } from "../types.js";

export const deleteNamespaceSchema = {
  name: "delete_namespace",
  description: "Delete a Kubernetes namespace",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      ignoreNotFound: { type: "boolean", default: false },
    },
    required: ["name"],
  },
} as const;

export async function deleteNamespace(k8sManager: KubernetesManager, input: {
  name: string;
  ignoreNotFound?: boolean;
}) {
  try {
    await k8sManager.getCoreApi().deleteNamespace(input.name);
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
