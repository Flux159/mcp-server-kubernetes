import { KubernetesManager } from "../types.js";

export const setCurrentContextSchema = {
  name: "set_current_context",
  description: "Set the current Kubernetes context",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the context to set as current"
      }
    },
    required: ["name"],
  },
} as const;

export async function setCurrentContext(
  k8sManager: KubernetesManager,
  input: { name: string }
) {
  try {
    // Set the current context
    k8sManager.setCurrentContext(input.name);
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Current context set to '${input.name}'`,
            context: input.name
          }, null, 2),
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to set current context: ${error.message}`);
  }
}
