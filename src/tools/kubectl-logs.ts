import { KubernetesManager } from "../types.js";
import { execSync } from "child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const kubectlLogsSchema = {
  name: "kubectl_logs",
  description: "Get logs from Kubernetes resources like pods, deployments, or jobs",
  inputSchema: {
    type: "object",
    properties: {
      resourceType: {
        type: "string",
        enum: ["pod", "deployment", "job", "cronjob"],
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
      container: {
        type: "string",
        description: "Container name (required when pod has multiple containers)",
        optional: true,
      },
      tail: {
        type: "number",
        description: "Number of lines to show from end of logs",
        optional: true,
      },
      since: {
        type: "string",
        description: "Show logs since relative time (e.g. '5s', '2m', '3h')",
        optional: true,
      },
      sinceTime: {
        type: "string",
        description: "Show logs since absolute time (RFC3339)",
        optional: true,
      },
      timestamps: {
        type: "boolean",
        description: "Include timestamps in logs",
        default: false,
      },
      previous: {
        type: "boolean",
        description: "Include logs from previously terminated containers",
        default: false,
      },
      follow: {
        type: "boolean",
        description: "Follow logs output (not recommended, may cause timeouts)",
        default: false,
      },
      labelSelector: {
        type: "string",
        description: "Filter resources by label selector",
        optional: true,
      }
    },
    required: ["resourceType", "name", "namespace"],
  },
} as const;

export async function kubectlLogs(
  k8sManager: KubernetesManager,
  input: {
    resourceType: string;
    name: string;
    namespace: string;
    container?: string;
    tail?: number;
    since?: string;
    sinceTime?: string;
    timestamps?: boolean;
    previous?: boolean;
    follow?: boolean;
    labelSelector?: string;
  }
) {
  try {
    const resourceType = input.resourceType.toLowerCase();
    const name = input.name;
    const namespace = input.namespace || "default";
    
    // Build the kubectl command base
    let baseCommand = `kubectl -n ${namespace}`;
    
    // Handle different resource types
    if (resourceType === "pod") {
      // Direct pod logs
      baseCommand += ` logs ${name}`;
      
      // If container is specified, add it
      if (input.container) {
        baseCommand += ` -c ${input.container}`;
      }
      
      // Add options
      baseCommand = addLogOptions(baseCommand, input);
      
      // Execute the command
      try {
        const result = execSync(baseCommand, { encoding: "utf8", env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG } });
        return formatLogOutput(name, result);
      } catch (error: any) {
        return handleCommandError(error, `pod ${name}`);
      }
    } else if (resourceType === "deployment" || resourceType === "job" || resourceType === "cronjob") {
      // For deployments, jobs and cronjobs we need to find the pods first
      let selectorCommand;
      
      if (resourceType === "deployment") {
        selectorCommand = `kubectl -n ${namespace} get deployment ${name} -o jsonpath='{.spec.selector.matchLabels}'`;
      } else if (resourceType === "job") {
        // For jobs, we use the job-name label
        return getLabelSelectorLogs(`job-name=${name}`, namespace, input);
      } else if (resourceType === "cronjob") {
        // For cronjobs, it's more complex - need to find the job first
        const jobsCommand = `kubectl -n ${namespace} get jobs --selector=job-name=${name} -o jsonpath='{.items[*].metadata.name}'`;
        try {
          const jobs = execSync(jobsCommand, { encoding: "utf8", env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG } }).trim().split(' ');
          
          if (jobs.length === 0 || (jobs.length === 1 && jobs[0] === '')) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      message: `No jobs found for cronjob ${name} in namespace ${namespace}`,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
          
          // Get logs for all jobs
          const allJobLogs: Record<string, any> = {};
          
          for (const job of jobs) {
            // Get logs for pods from this job
            const result = await getLabelSelectorLogs(`job-name=${job}`, namespace, input);
            const jobLog = JSON.parse(result.content[0].text);
            allJobLogs[job] = jobLog.logs;
          }
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    cronjob: name,
                    namespace: namespace,
                    jobs: allJobLogs,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error: any) {
          return handleCommandError(error, `cronjob ${name}`);
        }
      }
      
      try {
        if (resourceType === "deployment") {
          // Get the deployment's selector
          if (!selectorCommand) {
            throw new Error("Selector command is undefined");
          }
          const selectorJson = execSync(selectorCommand, { encoding: "utf8", env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG } }).trim();
          const selector = JSON.parse(selectorJson.replace(/'/g, '"'));
          
          // Convert to label selector format
          const labelSelector = Object.entries(selector)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
          
          return getLabelSelectorLogs(labelSelector, namespace, input);
        }
        
        // For jobs and cronjobs, the logic is handled above
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Unexpected resource type: ${resourceType}`,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      } catch (error: any) {
        return handleCommandError(error, `${resourceType} ${name}`);
      }
    } else if (input.labelSelector) {
      // Handle logs by label selector
      return getLabelSelectorLogs(input.labelSelector, namespace, input);
    } else {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unsupported resource type: ${resourceType}`
      );
    }
  } catch (error: any) {
    if (error instanceof McpError) throw error;
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get logs: ${error.message}`
    );
  }
}

// Helper function to add log options to the kubectl command
function addLogOptions(baseCommand: string, input: any): string {
  let command = baseCommand;
  
  // Add options based on inputs
  if (input.tail !== undefined) {
    command += ` --tail=${input.tail}`;
  }
  
  if (input.since) {
    command += ` --since=${input.since}`;
  }
  
  if (input.sinceTime) {
    command += ` --since-time=${input.sinceTime}`;
  }
  
  if (input.timestamps) {
    command += ` --timestamps`;
  }
  
  if (input.previous) {
    command += ` --previous`;
  }
  
  if (input.follow) {
    command += ` --follow`;
  }
  
  return command;
}

// Helper function to get logs for resources selected by labels
async function getLabelSelectorLogs(
  labelSelector: string,
  namespace: string,
  input: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    // First, find all pods matching the label selector
    const podsCommand = `kubectl -n ${namespace} get pods --selector=${labelSelector} -o jsonpath='{.items[*].metadata.name}'`;
    const pods = execSync(podsCommand, { encoding: "utf8", env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG } }).trim().split(' ');
    
    if (pods.length === 0 || (pods.length === 1 && pods[0] === '')) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: `No pods found with label selector "${labelSelector}" in namespace ${namespace}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
    
    // Get logs for each pod
    const logsMap: Record<string, string> = {};
    
    for (const pod of pods) {
      // Skip empty pod names
      if (!pod) continue;
      
      let podCommand = `kubectl -n ${namespace} logs ${pod}`;
      
      // Add container if specified
      if (input.container) {
        podCommand += ` -c ${input.container}`;
      }
      
      // Add other options
      podCommand = addLogOptions(podCommand, input);
      
      try {
        const logs = execSync(podCommand, { encoding: "utf8", env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG } });
        logsMap[pod] = logs;
      } catch (error: any) {
        logsMap[pod] = `Error: ${error.message}`;
      }
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              selector: labelSelector,
              namespace: namespace,
              logs: logsMap,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return handleCommandError(error, `pods with selector "${labelSelector}"`);
  }
}

// Helper function to format log output
function formatLogOutput(resourceName: string, logOutput: string) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            name: resourceName,
            logs: logOutput,
          },
          null,
          2
        ),
      },
    ],
  };
}

// Helper function to handle command errors
function handleCommandError(error: any, resourceDescription: string) {
  console.error(`Error getting logs for ${resourceDescription}:`, error);
  
  if (error.status === 404 || error.message.includes("not found")) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: `Resource ${resourceDescription} not found`,
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
  
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: `Failed to get logs for ${resourceDescription}: ${error.message}`,
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
} 