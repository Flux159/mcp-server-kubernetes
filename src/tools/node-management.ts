import { execFileSync } from "child_process";
import { getSpawnMaxBuffer } from "../config/max-buffer.js";

export const nodeManagementSchema = {
  name: "node_management",
  description: "Manage Kubernetes nodes with cordon, drain, and uncordon operations",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "Node operation to perform",
        enum: ["cordon", "drain", "uncordon", "list"],
      },
      nodeName: {
        type: "string",
        description: "Name of the node to operate on (required for cordon, drain, uncordon)",
      },
      force: {
        type: "boolean",
        description: "Force the operation even if there are pods not managed by a ReplicationController, ReplicaSet, Job, DaemonSet or StatefulSet (for drain operation)",
        default: false,
      },
      gracePeriod: {
        type: "number",
        description: "Period of time in seconds given to each pod to terminate gracefully (for drain operation)",
        default: -1,
      },
      deleteLocalData: {
        type: "boolean",
        description: "Delete local data even if emptyDir volumes are used (for drain operation)",
        default: false,
      },
      ignoreDaemonsets: {
        type: "boolean",
        description: "Ignore DaemonSet-managed pods (for drain operation)",
        default: true,
      },
      timeout: {
        type: "string",
        description: "The length of time to wait before giving up (for drain operation, e.g., '5m', '1h')",
        default: "0",
      },
      dryRun: {
        type: "boolean",
        description: "Show what would be done without actually doing it (for drain operation)",
        default: false,
      },
      confirmDrain: {
        type: "boolean",
        description: "Explicit confirmation to drain the node (required for drain operation)",
        default: false,
      },
    },
    required: ["operation"],
  },
};

interface NodeManagementParams {
  operation: "cordon" | "drain" | "uncordon" | "list";
  nodeName?: string;
  force?: boolean;
  gracePeriod?: number;
  deleteLocalData?: boolean;
  ignoreDaemonsets?: boolean;
  timeout?: string;
  dryRun?: boolean;
  confirmDrain?: boolean;
}

const executeCommand = (command: string, args: string[]): string => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 300000, // 5 minutes timeout for node operations
      maxBuffer: getSpawnMaxBuffer(),
      env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
    });
  } catch (error: any) {
    throw new Error(`${command} command failed: ${error.message}`);
  }
};

const getNodeStatus = (nodeName: string): any => {
  try {
    const output = executeCommand("kubectl", ["get", "node", nodeName, "-o", "json"]);
    return JSON.parse(output);
  } catch (error: any) {
    throw new Error(`Failed to get node status: ${error.message}`);
  }
};

const listNodes = (): any => {
  try {
    const output = executeCommand("kubectl", ["get", "nodes", "-o", "json"]);
    return JSON.parse(output);
  } catch (error: any) {
    throw new Error(`Failed to list nodes: ${error.message}`);
  }
};

export async function nodeManagement(
  params: NodeManagementParams
): Promise<{ content: { type: string; text: string }[] }> {
  const {
    operation,
    nodeName,
    force = false,
    gracePeriod = -1,
    deleteLocalData = false,
    ignoreDaemonsets = true,
    timeout = "0",
    dryRun = false,
    confirmDrain = false,
  } = params;

  try {
    let response: any = {
      operation: operation,
      timestamp: new Date().toISOString(),
    };

    switch (operation) {
      case "list": {
        const nodes = listNodes();
        response.message = `Found ${nodes.items?.length || 0} nodes in the cluster`;
        response.nodes = nodes.items?.map((node: any) => ({
          name: node.metadata.name,
          status: node.status?.conditions?.find((c: any) => c.type === "Ready")?.status || "Unknown",
          schedulable: !node.spec?.unschedulable,
          taints: node.spec?.taints || [],
        })) || [];
        break;
      }

      case "cordon": {
        if (!nodeName) {
          throw new Error("nodeName is required for cordon operation");
        }

        // Get node status before cordoning
        const beforeStatus = getNodeStatus(nodeName);
        const wasSchedulable = !beforeStatus.spec?.unschedulable;

        if (wasSchedulable) {
          executeCommand("kubectl", ["cordon", nodeName]);
          response.message = `Successfully cordoned node ${nodeName}`;
          response.action = "Node marked as unschedulable";
        } else {
          response.message = `Node ${nodeName} is already cordoned`;
          response.action = "No action taken - node already unschedulable";
        }

        // Get updated status
        const afterStatus = getNodeStatus(nodeName);
        response.nodeStatus = {
          name: nodeName,
          schedulable: !afterStatus.spec?.unschedulable,
          conditions: afterStatus.status?.conditions || [],
        };
        break;
      }

      case "uncordon": {
        if (!nodeName) {
          throw new Error("nodeName is required for uncordon operation");
        }

        // Get node status before uncordoning
        const beforeStatus = getNodeStatus(nodeName);
        const wasSchedulable = !beforeStatus.spec?.unschedulable;

        if (!wasSchedulable) {
          executeCommand("kubectl", ["uncordon", nodeName]);
          response.message = `Successfully uncordoned node ${nodeName}`;
          response.action = "Node marked as schedulable";
        } else {
          response.message = `Node ${nodeName} is already uncordoned`;
          response.action = "No action taken - node already schedulable";
        }

        // Get updated status
        const afterStatus = getNodeStatus(nodeName);
        response.nodeStatus = {
          name: nodeName,
          schedulable: !afterStatus.spec?.unschedulable,
          conditions: afterStatus.status?.conditions || [],
        };
        break;
      }

      case "drain": {
        if (!nodeName) {
          throw new Error("nodeName is required for drain operation");
        }

        // Get node status before draining
        const beforeStatus = getNodeStatus(nodeName);
        const wasSchedulable = !beforeStatus.spec?.unschedulable;

        // Build drain command arguments
        const drainArgs = ["drain", nodeName];

        if (force) {
          drainArgs.push("--force");
        }

        if (gracePeriod !== -1) {
          drainArgs.push("--grace-period", gracePeriod.toString());
        }

        if (deleteLocalData) {
          drainArgs.push("--delete-local-data");
        }

        if (ignoreDaemonsets) {
          drainArgs.push("--ignore-daemonsets");
        }

        if (timeout !== "0") {
          drainArgs.push("--timeout", timeout);
        }

        if (dryRun) {
          drainArgs.push("--dry-run=client");
        }

        if (dryRun) {
          // Dry run - show what would be done
          const dryRunOutput = executeCommand("kubectl", drainArgs);
          response.message = `Dry run for draining node ${nodeName}`;
          response.action = "Shows what would be done without actually doing it";
          response.dryRunOutput = dryRunOutput;
          response.nextStep = "To actually drain the node, set dryRun=false and confirmDrain=true";
        } else if (confirmDrain) {
          // Actually drain the node
          const drainOutput = executeCommand("kubectl", drainArgs);
          response.message = `Successfully drained node ${nodeName}`;
          response.action = "Node drained and marked as unschedulable";
          response.drainOutput = drainOutput;

          // Get updated status
          const afterStatus = getNodeStatus(nodeName);
          response.nodeStatus = {
            name: nodeName,
            schedulable: !afterStatus.spec?.unschedulable,
            conditions: afterStatus.status?.conditions || [],
          };
        } else {
          // Show what would be done without confirmation
          const dryRunOutput = executeCommand("kubectl", [...drainArgs, "--dry-run=client"]);
          response.message = `Drain operation requested for node ${nodeName} (not confirmed)`;
          response.action = "To actually drain the node, set confirmDrain=true";
          response.warning = "Drain operation requires explicit confirmation. Set confirmDrain=true to proceed.";
          response.dryRunOutput = dryRunOutput;
          response.nextStep = "To proceed with draining, call again with confirmDrain=true";
        }
        break;
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Node management operation failed: ${error.message}`);
  }
} 