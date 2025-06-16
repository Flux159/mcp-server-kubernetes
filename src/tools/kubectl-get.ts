import { KubernetesManager } from "../types.js";
import { execSync } from "child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const kubectlGetSchema = {
  name: "kubectl_get",
  description:
    "Get or list Kubernetes resources by resource type, name, and optionally namespace",
  inputSchema: {
    type: "object",
    properties: {
      resourceType: {
        type: "string",
        description:
          "Type of resource to get (e.g., pods, deployments, services, configmaps, events, etc.)",
      },
      name: {
        type: "string",
        description:
          "Name of the resource (optional - if not provided, lists all resources of the specified type)",
      },
      namespace: {
        type: "string",
        description:
          "Namespace of the resource (optional - defaults to 'default' for namespaced resources)",
        default: "default",
      },
      output: {
        type: "string",
        enum: ["json", "yaml", "wide", "name", "custom"],
        description: "Output format",
        default: "json",
      },
      allNamespaces: {
        type: "boolean",
        description: "If true, list resources across all namespaces",
        default: false,
      },
      labelSelector: {
        type: "string",
        description: "Filter resources by label selector (e.g. 'app=nginx')",
        optional: true,
      },
      fieldSelector: {
        type: "string",
        description:
          "Filter resources by field selector (e.g. 'metadata.name=my-pod')",
        optional: true,
      },
      sortBy: {
        type: "string",
        description:
          "Sort events by a field (default: lastTimestamp). Only applicable for events.",
        optional: true,
      },
    },
    required: ["resourceType"],
  },
} as const;

export async function kubectlGet(
  k8sManager: KubernetesManager,
  input: {
    resourceType: string;
    name?: string;
    namespace?: string;
    output?: string;
    allNamespaces?: boolean;
    labelSelector?: string;
    fieldSelector?: string;
    sortBy?: string;
  }
) {
  try {
    const resourceType = input.resourceType.toLowerCase();
    const name = input.name || "";
    const namespace = input.namespace || "default";
    const output = input.output || "json";
    const allNamespaces = input.allNamespaces || false;
    const labelSelector = input.labelSelector || "";
    const fieldSelector = input.fieldSelector || "";
    const sortBy = input.sortBy;

    // Build the kubectl command
    let command = "kubectl get ";

    // Add resource type
    command += resourceType;

    // Add name if provided
    if (name) {
      command += ` ${name}`;
    }

    // For events, default to all namespaces unless explicitly specified
    const shouldShowAllNamespaces =
      resourceType === "events"
        ? input.namespace
          ? false
          : true
        : allNamespaces;

    // Add namespace flag unless all namespaces is specified
    if (shouldShowAllNamespaces) {
      command += " --all-namespaces";
    } else if (namespace && !isNonNamespacedResource(resourceType)) {
      command += ` -n ${namespace}`;
    }

    // Add label selector if provided
    if (labelSelector) {
      command += ` -l ${labelSelector}`;
    }

    // Add field selector if provided
    if (fieldSelector) {
      command += ` --field-selector=${fieldSelector}`;
    }

    // Add sort-by for events
    if (resourceType === "events" && sortBy) {
      command += ` --sort-by=.${sortBy}`;
    } else if (resourceType === "events") {
      command += ` --sort-by=.lastTimestamp`;
    }

    // Add output format
    if (output === "json") {
      command += " -o json";
    } else if (output === "yaml") {
      command += " -o yaml";
    } else if (output === "wide") {
      command += " -o wide";
    } else if (output === "name") {
      command += " -o name";
    } else if (output === "custom") {
      if (resourceType === "events") {
        command += ` -o 'custom-columns=LAST SEEN:.lastTimestamp,TYPE:.type,REASON:.reason,OBJECT:.involvedObject.kind/.involvedObject.name,MESSAGE:.message'`;
      } else {
        command += ` -o 'custom-columns=NAME:.metadata.name,NAMESPACE:.metadata.namespace,STATUS:.status.phase,AGE:.metadata.creationTimestamp'`;
      }
    }

    // Execute the command
    try {
      const result = execSync(command, {
        encoding: "utf8",
        env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
      });

      // Format the results for better readability
      const isListOperation = !name;
      if (isListOperation && output === "json") {
        try {
          // Parse JSON and extract key information
          const parsed = JSON.parse(result);

          if (parsed.kind && parsed.kind.endsWith("List") && parsed.items) {
            if (resourceType === "events") {
              const formattedEvents = parsed.items.map((event: any) => ({
                type: event.type || "",
                reason: event.reason || "",
                message: event.message || "",
                involvedObject: {
                  kind: event.involvedObject?.kind || "",
                  name: event.involvedObject?.name || "",
                  namespace: event.involvedObject?.namespace || "",
                },
                firstTimestamp: event.firstTimestamp || "",
                lastTimestamp: event.lastTimestamp || "",
                count: event.count || 0,
              }));

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ events: formattedEvents }, null, 2),
                  },
                ],
              };
            } else {
              const items = parsed.items.map((item: any) => ({
                name: item.metadata?.name || "",
                namespace: item.metadata?.namespace || "",
                kind: item.kind || resourceType,
                status: getResourceStatus(item),
                createdAt: item.metadata?.creationTimestamp,
              }));

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ items }, null, 2),
                  },
                ],
              };
            }
          }
        } catch (parseError) {
          // If JSON parsing fails, return the raw output
          console.error("Error parsing JSON:", parseError);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      if (error.status === 404 || error.message.includes("not found")) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Resource ${resourceType}${
                    name ? `/${name}` : ""
                  } not found`,
                  status: "not_found",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get resource: ${error.message}`
      );
    }
  } catch (error: any) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute kubectl get command: ${error.message}`
    );
  }
}

// Extract status from various resource types
function getResourceStatus(resource: any): string {
  if (!resource) return "Unknown";

  // Pod status
  if (resource.status?.phase) {
    return resource.status.phase;
  }

  // Deployment, ReplicaSet, StatefulSet status
  if (resource.status?.readyReplicas !== undefined) {
    const ready = resource.status.readyReplicas || 0;
    const total = resource.status.replicas || 0;
    return `${ready}/${total} ready`;
  }

  // Service status
  if (resource.spec?.type) {
    return resource.spec.type;
  }

  // Node status
  if (resource.status?.conditions) {
    const readyCondition = resource.status.conditions.find(
      (c: any) => c.type === "Ready"
    );
    if (readyCondition) {
      return readyCondition.status === "True" ? "Ready" : "NotReady";
    }
  }

  // Job/CronJob status
  if (resource.status?.succeeded !== undefined) {
    return resource.status.succeeded ? "Completed" : "Running";
  }

  // PV/PVC status
  if (resource.status?.phase) {
    return resource.status.phase;
  }

  return "Active";
}

// Helper function to determine if a resource is non-namespaced
function isNonNamespacedResource(resourceType: string): boolean {
  const nonNamespacedResources = [
    "nodes",
    "node",
    "no",
    "namespaces",
    "namespace",
    "ns",
    "persistentvolumes",
    "pv",
    "storageclasses",
    "sc",
    "clusterroles",
    "clusterrolebindings",
    "customresourcedefinitions",
    "crd",
    "crds",
  ];

  return nonNamespacedResources.includes(resourceType.toLowerCase());
}
