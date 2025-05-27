import { KubernetesManager } from "../types.js";

export const deleteDeploymentSchema = {
  name: "delete_deployment",
  description: "Delete a Kubernetes deployment",
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

export async function deleteDeployment(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace: string;
    ignoreNotFound?: boolean;
  }
) {
  try {
    await k8sManager
      .getAppsApi()
      .deleteNamespacedDeployment(input.name, input.namespace);
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
