import { KubernetesManager } from "../types.js";
import { execSync } from "child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const kubectlGenericSchema = {
  name: "kubectl_generic",
  description: "Execute any kubectl command with the provided arguments and flags",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The kubectl command to execute (e.g. patch, rollout, top)"
      },
      subCommand: {
        type: "string",
        description: "Subcommand if applicable (e.g. 'history' for rollout)",
        optional: true
      },
      resourceType: {
        type: "string",
        description: "Resource type (e.g. pod, deployment)",
        optional: true
      },
      name: {
        type: "string",
        description: "Resource name",
        optional: true
      },
      namespace: {
        type: "string",
        description: "Namespace",
        default: "default",
        optional: true
      },
      outputFormat: {
        type: "string",
        description: "Output format (e.g. json, yaml, wide)",
        enum: ["json", "yaml", "wide", "name", "custom"],
        optional: true
      },
      flags: {
        type: "object",
        description: "Command flags as key-value pairs",
        optional: true,
        additionalProperties: true
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Additional command arguments",
        optional: true
      }
    },
    required: ["command"]
  }
};

export async function kubectlGeneric(
  k8sManager: KubernetesManager,
  input: {
    command: string;
    subCommand?: string;
    resourceType?: string;
    name?: string;
    namespace?: string;
    outputFormat?: string;
    flags?: Record<string, any>;
    args?: string[];
  }
) {
  try {
    // Start building the kubectl command
    let cmdArgs: string[] = ["kubectl", input.command];
    
    // Add subcommand if provided
    if (input.subCommand) {
      cmdArgs.push(input.subCommand);
    }
    
    // Add resource type if provided
    if (input.resourceType) {
      cmdArgs.push(input.resourceType);
    }
    
    // Add resource name if provided
    if (input.name) {
      cmdArgs.push(input.name);
    }
    
    // Add namespace if provided
    if (input.namespace) {
      cmdArgs.push(`--namespace=${input.namespace}`);
    }
    
    // Add output format if provided
    if (input.outputFormat) {
      cmdArgs.push(`-o=${input.outputFormat}`);
    }
    
    // Add any provided flags
    if (input.flags) {
      for (const [key, value] of Object.entries(input.flags)) {
        if (value === true) {
          // Handle boolean flags
          cmdArgs.push(`--${key}`);
        } else if (value !== false && value !== null && value !== undefined) {
          // Skip false/null/undefined values, add others as --key=value
          cmdArgs.push(`--${key}=${value}`);
        }
      }
    }
    
    // Add any additional arguments
    if (input.args && input.args.length > 0) {
      cmdArgs.push(...input.args);
    }
    
    // Execute the command (join all args except the first "kubectl" which is used in execSync)
    const command = cmdArgs.slice(1).join(' ');
    try {
      console.error(`Executing: kubectl ${command}`);
      const result = execSync(`kubectl ${command}`, { encoding: "utf8", env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG } });
      
      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to execute kubectl command: ${error.message}`
      );
    }
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute kubectl command: ${error.message}`
    );
  }
} 
