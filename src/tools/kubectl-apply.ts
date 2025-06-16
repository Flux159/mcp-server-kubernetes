import { KubernetesManager } from "../types.js";
import { execSync } from "child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export const kubectlApplySchema = {
  name: "kubectl_apply",
  description: "Apply a Kubernetes YAML manifest from a string or file",
  inputSchema: {
    type: "object",
    properties: {
      manifest: { 
        type: "string", 
        description: "YAML manifest to apply" 
      },
      filename: { 
        type: "string", 
        description: "Path to a YAML file to apply (optional - use either manifest or filename)" 
      },
      namespace: { 
        type: "string", 
        description: "Namespace to apply the resource to (optional)", 
        default: "default" 
      },
      dryRun: {
        type: "boolean",
        description: "If true, only validate the resource, don't apply it",
        default: false
      },
      force: {
        type: "boolean",
        description: "If true, immediately remove resources from API and bypass graceful deletion",
        default: false
      }
    },
    required: [],
  },
} as const;

export async function kubectlApply(
  k8sManager: KubernetesManager,
  input: {
    manifest?: string;
    filename?: string;
    namespace?: string;
    dryRun?: boolean;
    force?: boolean;
  }
) {
  try {
    if (!input.manifest && !input.filename) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Either manifest or filename must be provided"
      );
    }

    const namespace = input.namespace || "default";
    const dryRun = input.dryRun || false;
    const force = input.force || false;
    
    let command = "kubectl apply";
    let tempFile: string | null = null;
    
    // Process manifest content if provided
    if (input.manifest) {
      // Create temporary file for the manifest
      const tmpDir = os.tmpdir();
      tempFile = path.join(tmpDir, `manifest-${Date.now()}.yaml`);
      fs.writeFileSync(tempFile, input.manifest);
      command += ` -f ${tempFile}`;
    } else if (input.filename) {
      command += ` -f ${input.filename}`;
    }
    
    // Add namespace
    command += ` -n ${namespace}`;
    
    // Add dry-run flag if requested
    if (dryRun) {
      command += " --dry-run=client";
    }
    
    // Add force flag if requested
    if (force) {
      command += " --force";
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
        `Failed to apply manifest: ${error.message}`
      );
    }
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute kubectl apply command: ${error.message}`
    );
  }
} 