import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const listPodsSchema = {
  name: "list_pods",
  description: "List pods in a namespace",
  inputSchema: {
    type: "object",
    properties: {
      namespace: { type: "string", default: "default" },
    },
    required: ["namespace"],
  },
} as const;

export async function listPods(
  k8sManager: KubernetesManager,
  input: { namespace?: string }
) {
  const namespace = input.namespace || "default";
  const { body } = await k8sManager.getCoreApi().listNamespacedPod(namespace);

  const pods = body.items.map((pod: k8s.V1Pod) => ({
    name: pod.metadata?.name || "",
    namespace: pod.metadata?.namespace || "",
    phase: pod.status?.phase,
    createdAt: pod.metadata?.creationTimestamp,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ pods }, null, 2),
      },
    ],
  };
}
