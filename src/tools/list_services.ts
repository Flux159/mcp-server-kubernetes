import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const listServicesSchema = {
  name: "list_services",
  description: "List services in a namespace",
  inputSchema: {
    type: "object",
    properties: {
      namespace: { type: "string", default: "default" },
    },
    required: ["namespace"],
  },
} as const;

export async function listServices(k8sManager: KubernetesManager, input: { namespace?: string }) {
  const namespace = input.namespace || "default";
  const { body } = await k8sManager.getCoreApi().listNamespacedService(namespace);

  const services = body.items.map((service: k8s.V1Service) => ({
    name: service.metadata?.name || "",
    namespace: service.metadata?.namespace || "",
    type: service.spec?.type,
    clusterIP: service.spec?.clusterIP,
    ports: service.spec?.ports || [],
    createdAt: service.metadata?.creationTimestamp,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ services }, null, 2),
      },
    ],
  };
}
