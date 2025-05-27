import { KubernetesManager } from "../types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const getLogsSchema = {
  name: "get_logs",
  description:
    "Get logs from pods, deployments, jobs, or resources matching a label selector",
  inputSchema: {
    type: "object",
    properties: {
      resourceType: {
        type: "string",
        enum: ["pod", "deployment", "job"],
        description: "Type of resource to get logs from",
      },
      name: {
        type: "string",
        description: "Name of the resource",
      },
      namespace: {
        type: "string",
        description: "Namespace of the resource",
        default: "default",
      },
      labelSelector: {
        type: "string",
        description: "Label selector to filter resources",
        optional: true,
      },
      container: {
        type: "string",
        description:
          "Container name (required when pod has multiple containers)",
        optional: true,
      },
      tail: {
        type: "number",
        description: "Number of lines to show from end of logs",
        optional: true,
      },
      since: {
        type: "number",
        description: "Get logs since relative time in seconds",
        optional: true,
      },
      timestamps: {
        type: "boolean",
        description: "Include timestamps in logs",
        default: false,
      },
    },
    required: ["resourceType"],
  },
} as const;

async function getPodLogs(
  k8sManager: KubernetesManager,
  podName: string,
  podNamespace: string,
  input: {
    container?: string;
    tail?: number;
    sinceSeconds?: number;
    timestamps?: boolean;
    pretty?: boolean;
    follow?: boolean;
  }
): Promise<string> {
  try {
    const { body } = await k8sManager.getCoreApi().readNamespacedPodLog(
      podName,
      podNamespace,
      input.container,
      input.follow,
      undefined, // insecureSkipTLSVerifyBackend
      undefined, // limitBytes
      input.pretty ? "true" : "false",
      undefined, // previous
      input.sinceSeconds,
      input.tail,
      input.timestamps
    );
    return body;
  } catch (error: any) {
    if (error.response?.statusCode === 404) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Pod ${podName} not found in namespace ${podNamespace}`
      );
    }
    // Log full error details
    console.error("Full error:", {
      statusCode: error.response?.statusCode,
      message: error.response?.body?.message || error.message,
      details: error.response?.body,
    });
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get logs for pod ${podName}: ${
        error.response?.body?.message || error.message
      }`
    );
  }
}

export async function getLogs(k8sManager: KubernetesManager, input: {
  resourceType: string;
  name?: string;
  namespace?: string;
  labelSelector?: string;
  container?: string;
  tail?: number;
  sinceSeconds?: number;
  timestamps?: boolean;
  pretty?: boolean;
  follow?: false;
}) {
  const namespace = input.namespace || "default";
  const logs: { [key: string]: string } = {};

  try {
    // Get logs based on resource type
    switch (input.resourceType.toLowerCase()) {
      case "pod": {
        if (!input.name) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Pod name is required when resourceType is 'pod'"
          );
        }
        logs[input.name] = await getPodLogs(k8sManager, input.name, namespace, input);
        break;
      }

      case "deployment": {
        if (!input.name) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Deployment name is required when resourceType is 'deployment'"
          );
        }
        const { body: deployment } = await k8sManager
          .getAppsApi()
          .readNamespacedDeployment(input.name, namespace);
        if (!deployment.spec?.selector?.matchLabels) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Deployment ${input.name} has no selector`
          );
        }

        const selector = Object.entries(deployment.spec.selector.matchLabels)
          .map(([key, value]) => `${key}=${value}`)
          .join(",");

        const { body: podList } = await k8sManager
          .getCoreApi()
          .listNamespacedPod(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            selector
          );

        for (const pod of podList.items) {
          if (pod.metadata?.name) {
            logs[pod.metadata.name] = await getPodLogs(
              k8sManager,
              pod.metadata.name,
              namespace,
              input
            );
          }
        }
        break;
      }

      case "job": {
        if (!input.name) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Job name is required when resourceType is 'job'"
          );
        }
        const { body: podList } = await k8sManager
          .getCoreApi()
          .listNamespacedPod(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            `job-name=${input.name}`
          );

        for (const pod of podList.items) {
          if (pod.metadata?.name) {
            logs[pod.metadata.name] = await getPodLogs(
              k8sManager,
              pod.metadata.name,
              namespace,
              input
            );
          }
        }
        break;
      }

      default:
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unsupported resource type: ${input.resourceType}`
        );
    }

    // If labelSelector is provided, filter or add logs by label
    if (input.labelSelector) {
      const { body: labeledPods } = await k8sManager
        .getCoreApi()
        .listNamespacedPod(
          namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          input.labelSelector
        );

      for (const pod of labeledPods.items) {
        if (pod.metadata?.name) {
          logs[pod.metadata.name] = await getPodLogs(
            k8sManager,
            pod.metadata.name,
            namespace,
            input
          );
        }
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ logs }, null, 2),
        },
      ],
    };
  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get logs: ${error}`
    );
  }
}
