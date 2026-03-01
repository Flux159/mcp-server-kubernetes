/**
 * Tool: exec_in_pod
 * Execute a command in a Kubernetes pod or container and return the output.
 * Uses kubectl exec for consistency with other kubectl-based tools.
 *
 * SECURITY: Only accepts commands as an array of strings. This prevents command
 * injection attacks by using execFileSync which executes directly without shell
 * interpretation. Shell operators (pipes, redirects, etc.) are intentionally
 * not supported.
 */

import { KubernetesManager } from "../types.js";
import { execFileSync } from "child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getSpawnMaxBuffer } from "../config/max-buffer.js";
import { contextParameter, namespaceParameter } from "../models/common-parameters.js";

/**
 * Schema for exec_in_pod tool.
 * - name: Pod name
 * - namespace: Namespace (default: "default")
 * - command: Command to execute as array of strings (e.g. ["ls", "-la"])
 * - container: (Optional) Container name
 */
export const execInPodSchema = {
  name: "exec_in_pod",
  description: "Execute a command in a Kubernetes pod or container and return the output. Command must be an array of strings where the first element is the executable and remaining elements are arguments. This executes directly without shell interpretation for security.",
  annotations: {
    destructiveHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the pod to execute the command in",
      },
      namespace: namespaceParameter,
      command: {
        type: "array",
        items: { type: "string" },
        description: "Command to execute as an array of strings (e.g. [\"ls\", \"-la\", \"/app\"]). First element is the executable, remaining are arguments. Shell operators like pipes, redirects, or command chaining are not supported - use explicit array format for security.",
      },
      container: {
        type: "string",
        description: "Container name (required when pod has multiple containers)",
      },
      timeout: {
        type: "number",
        description: "Timeout for command - 60000 milliseconds if not specified",
      },
      context: contextParameter,
    },
    required: ["name", "command"],
  },
};

/**
 * Execute a command in a Kubernetes pod or container using kubectl exec.
 * Returns the stdout output as a text response.
 * Throws McpError on failure.
 *
 * SECURITY: Command must be an array of strings. execFileSync does not invoke
 * a shell, preventing command injection.
 */
export async function execInPod(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace?: string;
    command: string[];
    container?: string;
    timeout?: number;
    context?: string;
  }
): Promise<{ content: { type: string; text: string }[] }> {
  const namespace = input.namespace || "default";

  // Validate command is an array (defense in depth - schema should enforce this)
  if (!Array.isArray(input.command)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Command must be an array of strings (e.g. [\"ls\", \"-la\"]). String commands are not supported for security reasons."
    );
  }

  if (input.command.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Command array cannot be empty"
    );
  }

  // Validate all elements are strings
  for (let i = 0; i < input.command.length; i++) {
    if (typeof input.command[i] !== "string") {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Command array element at index ${i} must be a string`
      );
    }
  }

  try {
    const args = ["exec", input.name, "-n", namespace];

    if (input.container) {
      args.push("-c", input.container);
    }

    if (input.context) {
      args.push("--context", input.context);
    }

    args.push("--", ...input.command);

    const timeoutMs = input.timeout || 60000;

    const result = execFileSync("kubectl", args, {
      encoding: "utf8",
      maxBuffer: getSpawnMaxBuffer(),
      timeout: timeoutMs,
      env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
    });

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  } catch (error: any) {
    if (error.killed || error.signal === "SIGTERM") {
      throw new McpError(
        ErrorCode.InternalError,
        "Exec operation timed out (possible networking, RBAC, or cluster issue)"
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute command in pod: ${error.stderr || error.message}`
    );
  }
}
