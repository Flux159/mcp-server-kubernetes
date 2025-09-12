/**
 * Tool: exec_in_pod
 * Execute a command in a Kubernetes pod or container and return the output.
 * Uses the official Kubernetes client-node Exec API for native execution.
 * Supports both string and array command formats, and optional container targeting.
 */

import * as k8s from "@kubernetes/client-node";
import { KubernetesManager } from "../types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { Writable } from "stream";
import { contextParameter, namespaceParameter } from "../models/common-parameters.js";

/**
 * Schema for exec_in_pod tool.
 * - name: Pod name
 * - namespace: Namespace (default: "default")
 * - command: Command to execute (string or array of args)
 * - container: (Optional) Container name
 */
export const execInPodSchema = {
  name: "exec_in_pod",
  description: "Execute a command in a Kubernetes pod or container and return the output",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the pod to execute the command in",
      },
      namespace: namespaceParameter,
      command: {
        anyOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } }
        ],
        description: "Command to execute in the pod (string or array of args)",
      },
      container: {
        type: "string",
        description: "Container name (required when pod has multiple containers)",
      },
      shell: {
        type: "string",
        description: "Shell to use for command execution (e.g. '/bin/sh', '/bin/bash'). If not provided, will use command as-is.",
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
 * Execute a command in a Kubernetes pod or container using the Kubernetes client-node Exec API.
 * Returns the stdout output as a text response.
 * Throws McpError on failure.
 */
export async function execInPod(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace?: string;
    command: string | string[];
    container?: string;
    shell?: string;
    timeout?: number;
    context?: string;
  }
): Promise<{ content: { type: string; text: string }[] }> {
  const namespace = input.namespace || "default";
  // Convert command to array of strings for the Exec API
  let commandArr: string[];
  if (Array.isArray(input.command)) {
    commandArr = input.command;
  } else {
    // Always wrap string commands in a shell for correct parsing
    const shell = input.shell || "/bin/sh";
    commandArr = [shell, "-c", input.command];
    console.log("[exec_in_pod] Using shell:", shell, "Command array:", commandArr);
  }

  // Prepare buffers to capture stdout and stderr
  let stdout = "";
  let stderr = "";

  // Use Node.js Writable streams to collect output
  const stdoutStream = new Writable({
    write(chunk, _encoding, callback) {
      stdout += chunk.toString();
      callback();
    }
  });
  const stderrStream = new Writable({
    write(chunk, _encoding, callback) {
      stderr += chunk.toString();
      callback();
    }
  });
  // Add a dummy stdin stream
  const stdinStream = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });

  try {
    // Set context if provided
    if (input.context) {
      k8sManager.setCurrentContext(input.context);
    }

    // Use the Kubernetes client-node Exec API for native exec
    const kc = k8sManager.getKubeConfig();
    const exec = new k8s.Exec(kc);

    // Add a timeout to avoid hanging forever if exec never returns
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const timeoutMs = input.timeout || 60000;
      const timeout = setTimeout(() => {
        if (!finished) {
          finished = true;
          reject(
            new McpError(
              ErrorCode.InternalError,
              "Exec operation timed out (possible networking, RBAC, or cluster issue)"
            )
          );
        }
      }, timeoutMs);

      console.log("[exec_in_pod] Calling exec.exec with params:", {
        namespace,
        pod: input.name,
        container: input.container ?? "",
        commandArr,
        stdoutStreamType: typeof stdoutStream,
        stderrStreamType: typeof stderrStream,
      });

      exec.exec(
        namespace,
        input.name,
        input.container ?? "",
        commandArr,
        stdoutStream as any,
        stderrStream as any,
        stdinStream as any, // use dummy stdin
        true, // set tty to true
        (status: any) => {
          console.log("[exec_in_pod] exec.exec callback called. Status:", status);
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          // Always resolve; handle errors based on stderr or thrown errors
          resolve();
        }
      ).catch((err: any) => {
        console.log("[exec_in_pod] exec.exec threw error:", err);
        if (!finished) {
          finished = true;
          clearTimeout(timeout);
          reject(
            new McpError(
              ErrorCode.InternalError,
              `Exec threw error: ${err?.message || err}`
            )
          );
        }
      });
    });

    // Return the collected stdout as the result
    // If there is stderr output or no output at all, treat as error
    if (stderr || (!stdout && !stderr)) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to execute command in pod: ${stderr || "No output"}`
      );
    }
    return {
      content: [
        {
          type: "text",
          text: stdout,
        },
      ],
    };
  } catch (error: any) {
    // Collect error message and stderr output if available
    let message = error.message || "Unknown error";
    if (stderr) {
      message += "\n" + stderr;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute command in pod: ${message}`
    );
  }
}
