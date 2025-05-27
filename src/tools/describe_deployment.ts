import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const describeDeploymentSchema = {
  name: "describe_deployment",
  description: "Get details about a Kubernetes deployment",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string" },
    },
    required: ["name", "namespace"],
  },
} as const;

export async function describeDeployment(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace: string;
  }
) {
  const { body } = await k8sManager
    .getAppsApi()
    .readNamespacedDeployment(input.name, input.namespace)
    .catch((error: any) => {
      console.error("Deployment description error:", {
        status: error.response?.statusCode,
        message: error.response?.body?.message || error.message,
        details: error.response?.body,
      });
      throw error;
    });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            name: body.metadata?.name,
            namespace: body.metadata?.namespace,
            replicas: body.spec?.replicas,
            availableReplicas: body.status?.availableReplicas,
            spec: body.spec,
            status: body.status,
          },
          null,
          2
        ),
      },
    ],
  };
}
