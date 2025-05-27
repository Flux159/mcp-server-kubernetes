import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const listDeploymentsSchema = {
  name: "list_deployments",
  description: "List deployments in a namespace",
  inputSchema: {
    type: "object",
    properties: {
      namespace: { type: "string", default: "default" },
    },
    required: ["namespace"],
  },
} as const;

export async function listDeployments(k8sManager: KubernetesManager, input: { namespace?: string }) {
  const namespace = input.namespace || "default";
  const { body } = await k8sManager.getAppsApi().listNamespacedDeployment(namespace);

  const deployments = body.items.map((deployment: k8s.V1Deployment) => ({
    name: deployment.metadata?.name || "",
    namespace: deployment.metadata?.namespace || "",
    replicas: deployment.spec?.replicas || 0,
    availableReplicas: deployment.status?.availableReplicas || 0,
    createdAt: deployment.metadata?.creationTimestamp,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ deployments }, null, 2),
      },
    ],
  };
}
