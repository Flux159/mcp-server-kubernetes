import { KubernetesManager } from "../types.js";

export const getCurrentContextSchema = {
  name: "get_current_context",
  description: "Get the current Kubernetes context",
  inputSchema: {
    type: "object",
    properties: {
      detailed: {
        type: "boolean",
        description: "Include detailed information about the current context",
        default: false
      }
    }
  },
} as const;

export async function getCurrentContext(
  k8sManager: KubernetesManager,
  input: { detailed?: boolean }
) {
  try {
    // Get the KubeConfig from the KubernetesManager
    const kc = k8sManager.getKubeConfig();

    // Get the current context name
    const currentContextName = kc.getCurrentContext();
    
    // If detailed is true, get more information about the context
    if (input.detailed) {
      const contexts = kc.getContexts();
      const currentContext = contexts.find(context => context.name === currentContextName);
      
      if (!currentContext) {
        throw new Error(`Current context '${currentContextName}' not found in available contexts`);
      }
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              name: currentContextName,
              cluster: currentContext.cluster,
              user: currentContext.user,
              namespace: currentContext.namespace || "default"
            }, null, 2),
          },
        ],
      };
    }
    
    // Simple response with just the context name
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ currentContext: currentContextName }, null, 2),
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to get current context: ${error.message}`);
  }
}
