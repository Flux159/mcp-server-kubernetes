import { KubernetesManager } from "../types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const kubectlReconnectSchema = {
  name: "kubectl_reconnect",
  description:
    "Reconnect to the Kubernetes API server by recreating all API clients. Use this after cluster upgrades (e.g., EKS control plane upgrades that rotate ENIs/IPs) to force fresh DNS resolution and new TCP connections.",
  annotations: {
    readOnlyHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
} as const;

export async function kubectlReconnect(k8sManager: KubernetesManager) {
  try {
    k8sManager.refreshApiClients();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              message:
                "API clients refreshed. DNS will be re-resolved on the next request.",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to reconnect: ${error.message}`
    );
  }
}
