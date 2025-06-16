import { KubernetesManager } from "../types.js";
import { execSync } from "child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export const kubectlDeleteSchema = {
  name: "kubectl_delete",
  description: "Delete Kubernetes resources by resource type, name, labels, or from a manifest file",
  inputSchema: {
    type: "object",
    properties: {
      resourceType: { 
        type: "string", 
        description: "Type of resource to delete (e.g., pods, deployments, services, etc.)"
      },
      name: { 
        type: "string", 
        description: "Name of the resource to delete" 
      },
      namespace: { 
        type: "string", 
        description: "Namespace of the resource (optional - defaults to 'default' for namespaced resources)", 
        default: "default" 
      },
      labelSelector: {
        type: "string",
        description: "Delete resources matching this label selector (e.g. 'app=nginx')",
        optional: true
      },
      manifest: { 
        type: "string", 
        description: "YAML manifest defining resources to delete (optional)", 
        optional: true
      },
      filename: { 
        type: "string", 
        description: "Path to a YAML file to delete resources from (optional)", 
        optional: true
      },
      allNamespaces: {
        type: "boolean",
        description: "If true, delete resources across all namespaces",
        default: false
      },
      force: {
        type: "boolean",
        description: "If true, immediately remove resources from API and bypass graceful deletion",
        default: false
      },
      gracePeriodSeconds: {
        type: "number",
        description: "Period of time in seconds given to the resource to terminate gracefully",
        optional: true
      }
    },
    required: [],
  },
} as const;

export async function kubectlDelete(
  k8sManager: KubernetesManager,
  input: {
    resourceType?: string;
    name?: string;
    namespace?: string;
    labelSelector?: string;
    manifest?: string;
    filename?: string;
    allNamespaces?: boolean;
    force?: boolean;
    gracePeriodSeconds?: number;
  }
) {
  try {
    // Validate input - need at least one way to identify resources
    if (!input.resourceType && !input.manifest && !input.filename) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Either resourceType, manifest, or filename must be provided"
      );
    }
    
    // If resourceType is provided, need either name or labelSelector
    if (input.resourceType && !input.name && !input.labelSelector) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "When using resourceType, either name or labelSelector must be provided"
      );
    }

    const namespace = input.namespace || "default";
    const allNamespaces = input.allNamespaces || false;
    const force = input.force || false;
    
    let command = "kubectl delete";
    let tempFile: string | null = null;
    
    // Handle deleting from manifest or file
    if (input.manifest) {
      // Create temporary file for the manifest
      const tmpDir = os.tmpdir();
      tempFile = path.join(tmpDir, `delete-manifest-${Date.now()}.yaml`);
      fs.writeFileSync(tempFile, input.manifest);
      command += ` -f ${tempFile}`;
    } else if (input.filename) {
      command += ` -f ${input.filename}`;
    } else {
      // Handle deleting by resource type and name/selector
      command += ` ${input.resourceType}`;
      
      if (input.name) {
        command += ` ${input.name}`;
      }
      
      if (input.labelSelector) {
        command += ` -l ${input.labelSelector}`;
      }
    }
    
    // Add namespace flags
    if (allNamespaces) {
      command += " --all-namespaces";
    } else if (namespace && input.resourceType && !isNonNamespacedResource(input.resourceType)) {
      command += ` -n ${namespace}`;
    }
    
    // Add force flag if requested
    if (force) {
      command += " --force";
    }
    
    // Add grace period if specified
    if (input.gracePeriodSeconds !== undefined) {
      command += ` --grace-period=${input.gracePeriodSeconds}`;
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
      
      if (error.status === 404 || error.message.includes("not found")) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Resource not found`,
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
        `Failed to delete resource: ${error.message}`
      );
    }
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute kubectl delete command: ${error.message}`
    );
  }
}

// Helper function to determine if a resource is non-namespaced
function isNonNamespacedResource(resourceType: string): boolean {
  const nonNamespacedResources = [
    "nodes", "node", "no",
    "namespaces", "namespace", "ns",
    "persistentvolumes", "pv",
    "storageclasses", "sc",
    "clusterroles",
    "clusterrolebindings",
    "customresourcedefinitions", "crd", "crds"
  ];
  
  return nonNamespacedResources.includes(resourceType.toLowerCase());
} 