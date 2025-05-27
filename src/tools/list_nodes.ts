import { KubernetesManager } from "../types.js";

export const listNodesSchema = {
  name: "list_nodes",
  description: "List all nodes in the cluster",
  inputSchema: {
    type: "object",
    properties: {},
  },
} as const;

export async function listNodes(k8sManager: KubernetesManager) {
  const { body } = await k8sManager.getCoreApi().listNode();
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            nodes: body.items,
          },
          null,
          2
        ),
      },
    ],
  };
}
