import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const createNamespaceSchema = {
  name: "create_namespace",
  description: "Create a new Kubernetes namespace",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
    },
    required: ["name"],
  },
} as const;

export async function createNamespace(
  k8sManager: KubernetesManager,
  input: {
    name: string;
  }
) {
  const namespace: k8s.V1Namespace = {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: input.name,
      labels: {
        "mcp-managed": "true",
        app: input.name,
      },
    },
    spec: {},
  };

  try {
    const response = await k8sManager.getCoreApi().createNamespace(namespace);

    k8sManager.trackResource("Namespace", input.name, input.name);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              namespaceName: response.body.metadata!.name!,
              status: "created",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    console.error("Namespace creation error:", {
      status: error.response?.statusCode,
      message: error.response?.body?.message || error.message,
      details: error.response?.body,
    });
    throw error;
  }
}
