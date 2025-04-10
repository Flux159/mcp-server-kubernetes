import { KubernetesManager } from "../types.js";

export const listContextsSchema = {
  name: "list_contexts",
  description: "List all available Kubernetes contexts",
  inputSchema: {
    type: "object",
    properties: {
      showCurrent: {
        type: "boolean",
        description: "Show which context is currently active",
        default: true
      }
    }
  },
} as const;

export async function listContexts(
  k8sManager: KubernetesManager,
  input: { showCurrent?: boolean }
) {
  try {
    // Get the KubeConfig from the KubernetesManager
    const kc = k8sManager.getKubeConfig();

    const contexts = kc.getContexts();
    const currentContext = input.showCurrent ? kc.getCurrentContext() : undefined;

    const contextList = contexts.map(context => ({
      name: context.name,
      cluster: context.cluster,
      user: context.user,
      isCurrent: context.name === currentContext
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ contexts: contextList }, null, 2),
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to list contexts: ${error.message}`);
  }
}