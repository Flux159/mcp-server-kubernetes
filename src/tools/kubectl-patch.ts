import { KubernetesManager } from "../types.js";
import { execSync } from "child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export const kubectlPatchSchema = {
  name: "kubectl_patch",
  description: "Update field(s) of a resource using strategic merge patch, JSON merge patch, or JSON patch",
  inputSchema: {
    type: "object",
    properties: {
      resourceType: { 
        type: "string", 
        description: "Type of resource to patch (e.g., pods, deployments, services)" 
      },
      name: { 
        type: "string", 
        description: "Name of the resource to patch"
      },
      namespace: { 
        type: "string", 
        description: "Namespace of the resource", 
        default: "default" 
      },
      patchType: {
        type: "string",
        description: "Type of patch to apply",
        enum: ["strategic", "merge", "json"],
        default: "strategic"
      },
      patchData: {
        type: "object",
        description: "Patch data as a JSON object"
      },
      patchFile: {
        type: "string",
        description: "Path to a file containing the patch data (alternative to patchData)"
      },
      dryRun: {
        type: "boolean",
        description: "If true, only print the object that would be sent, without sending it",
        default: false
      }
    },
    required: ["resourceType", "name"],
  }
};

export async function kubectlPatch(
  k8sManager: KubernetesManager,
  input: {
    resourceType: string;
    name: string;
    namespace?: string;
    patchType?: "strategic" | "merge" | "json";
    patchData?: object;
    patchFile?: string;
    dryRun?: boolean;
  }
) {
  try {
    if (!input.patchData && !input.patchFile) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Either patchData or patchFile must be provided"
      );
    }

    const namespace = input.namespace || "default";
    const patchType = input.patchType || "strategic";
    const dryRun = input.dryRun || false;
    let tempFile: string | null = null;
    
    // Build the kubectl patch command
    let command = `kubectl patch ${input.resourceType} ${input.name} -n ${namespace}`;
    
    // Add patch type flag
    switch (patchType) {
      case "strategic":
        command += " --type strategic";
        break;
      case "merge":
        command += " --type merge";
        break;
      case "json":
        command += " --type json";
        break;
      default:
        command += " --type strategic";
    }
    
    // Handle patch data
    if (input.patchData) {
      // Create a temporary file for the patch data
      const tmpDir = os.tmpdir();
      tempFile = path.join(tmpDir, `patch-${Date.now()}.json`);
      fs.writeFileSync(tempFile, JSON.stringify(input.patchData));
      command += ` --patch-file ${tempFile}`;
    } else if (input.patchFile) {
      command += ` --patch-file ${input.patchFile}`;
    }
    
    // Add dry-run flag if requested
    if (dryRun) {
      command += " --dry-run=client";
    }
    
    // Execute the command
    try {
      const result = execSync(command, { encoding: "utf8", env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG } });
      
      // Clean up temp file if created
      if (tempFile) {
        try {
          fs.unlinkSync(tempFile);
        } catch (err) {
          console.warn(`Failed to delete temporary file ${tempFile}: ${err}`);
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
      // Clean up temp file if created, even if command failed
      if (tempFile) {
        try {
          fs.unlinkSync(tempFile);
        } catch (err) {
          console.warn(`Failed to delete temporary file ${tempFile}: ${err}`);
        }
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to patch resource: ${error.message}`
      );
    }
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute kubectl patch command: ${error.message}`
    );
  }
} 