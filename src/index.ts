#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// Import only the function implementations we need for the switch statement
import { listPods } from "./tools/list_pods.js";
import { listNodes } from "./tools/list_nodes.js";
import { listServices } from "./tools/list_services.js";
import { listDeployments } from "./tools/list_deployments.js";
import { listCronJobs } from "./tools/list_cronjobs.js";
import { describeCronJob } from "./tools/describe_cronjob.js";
import { listJobs, listJobsSchema } from "./tools/list_jobs.js";
import { getJobLogs, getJobLogsSchema } from "./tools/get_job_logs.js";
import { describeNode } from "./tools/describe_node.js";
import {
  installHelmChart,
  installHelmChartSchema,
  upgradeHelmChart,
  upgradeHelmChartSchema,
  uninstallHelmChart,
  uninstallHelmChartSchema,
} from "./tools/helm-operations.js";
import {
  explainResource,
  explainResourceSchema,
  listApiResources,
  listApiResourcesSchema,
} from "./tools/kubectl-operations.js";
import {
  createNamespace,
  createNamespaceSchema,
} from "./tools/create_namespace.js";
import { createPod, createPodSchema } from "./tools/create_pod.js";
import { createCronJob, createCronJobSchema } from "./tools/create_cronjob.js";
import { DeleteCronJob, DeleteCronJobSchema } from "./tools/delete_cronjob.js";
import { deletePod, deletePodSchema } from "./tools/delete_pod.js";
import { describePod } from "./tools/describe_pod.js";
import { getLogs, getLogsSchema } from "./tools/get_logs.js";
import { getEvents, getEventsSchema } from "./tools/get_events.js";
import { getResourceHandlers } from "./resources/handlers.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as k8s from "@kubernetes/client-node";
import { KubernetesManager } from "./types.js";
import { serverConfig } from "./config/server-config.js";
import { createDeploymentSchema } from "./config/deployment-config.js";
import { listNamespacesSchema } from "./config/namespace-config.js";
import {
  deleteNamespace,
  deleteNamespaceSchema,
} from "./tools/delete_namespace.js";
import { cleanupSchema } from "./config/cleanup-config.js";
import { startSSEServer } from "./utils/sse.js";
import {
  startPortForward,
  PortForwardSchema,
  stopPortForward,
  StopPortForwardSchema,
} from "./tools/port_forward.js";
import {
  deleteDeployment,
  deleteDeploymentSchema,
} from "./tools/delete_deployment.js";
import { createDeployment } from "./tools/create_deployment.js";
import {
  scaleDeployment,
  scaleDeploymentSchema,
} from "./tools/scale_deployment.js";
import { describeDeployment } from "./tools/describe_deployment.js";
import {
  updateDeployment,
  updateDeploymentSchema,
} from "./tools/update_deployment.js";
import {
  createConfigMap,
  CreateConfigMapSchema,
} from "./tools/create_configmap.js";
import { getConfigMap } from "./tools/get_configmap.js";
import { updateConfigMap, UpdateConfigMapSchema } from "./tools/update_configmap.js";
import { deleteConfigMap, DeleteConfigMapSchema } from "./tools/delete_configmap.js";
import { listContexts, listContextsSchema } from "./tools/list_contexts.js";
import {
  getCurrentContext,
  getCurrentContextSchema,
} from "./tools/get_current_context.js";
import {
  setCurrentContext,
  setCurrentContextSchema,
} from "./tools/set_current_context.js";
import { createService, createServiceSchema } from "./tools/create_service.js";
import { describeService } from "./tools/describe_service.js";
import { updateService, updateServiceSchema } from "./tools/update_service.js";
import { deleteService, deleteServiceSchema } from "./tools/delete_service.js";
import { kubectlGet, kubectlGetSchema } from "./tools/kubectl-get.js";
import { kubectlDescribe, kubectlDescribeSchema } from "./tools/kubectl-describe.js";
import { kubectlList, kubectlListSchema } from "./tools/kubectl-list.js";
import { kubectlApply, kubectlApplySchema } from "./tools/kubectl-apply.js";
import { kubectlDelete, kubectlDeleteSchema } from "./tools/kubectl-delete.js";
import { kubectlCreate, kubectlCreateSchema } from "./tools/kubectl-create.js";

// Check if non-destructive tools only mode is enabled
const nonDestructiveTools =
  process.env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS === "true";

// Define destructive tools (delete and uninstall operations)
const destructiveTools = [
  deletePodSchema,
  deleteServiceSchema,
  deleteDeploymentSchema,
  deleteNamespaceSchema,
  uninstallHelmChartSchema,
  DeleteCronJobSchema,
  cleanupSchema, // Cleanup is also destructive as it deletes resources
];

// Get all available tools
const allTools = [
  // Core operation tools
  cleanupSchema,
  
  // Unified kubectl-style tools - these replace many specific tools
  kubectlGetSchema,
  kubectlDescribeSchema,
  kubectlListSchema,
  kubectlApplySchema,
  kubectlDeleteSchema,
  kubectlCreateSchema,
  
  // Creation tools
  createDeploymentSchema,
  createNamespaceSchema,
  createPodSchema,
  createCronJobSchema,
  createServiceSchema,
  CreateConfigMapSchema,
  
  // Deletion tools
  deletePodSchema,
  deleteDeploymentSchema,
  deleteNamespaceSchema,
  deleteServiceSchema,
  DeleteCronJobSchema,
  DeleteConfigMapSchema,
  
  // Update tools
  updateDeploymentSchema,
  updateServiceSchema,
  UpdateConfigMapSchema,
  
  // Special operations
  scaleDeploymentSchema,
  
  // Kubernetes context management
  listContextsSchema,
  getCurrentContextSchema,
  setCurrentContextSchema,
  
  // Special operations that aren't covered by simple kubectl commands
  explainResourceSchema,
  getEventsSchema,
  getJobLogsSchema,
  getLogsSchema,
  
  // Helm operations
  installHelmChartSchema,
  upgradeHelmChartSchema,
  uninstallHelmChartSchema,
  
  // Port forwarding
  PortForwardSchema,
  StopPortForwardSchema,
  
  // API resource operations
  listApiResourcesSchema,
];

const k8sManager = new KubernetesManager();

const server = new Server(
  {
    name: serverConfig.name,
    version: serverConfig.version,
  },
  serverConfig
);

// Resources handlers
const resourceHandlers = getResourceHandlers(k8sManager);
server.setRequestHandler(
  ListResourcesRequestSchema,
  resourceHandlers.listResources
);
server.setRequestHandler(
  ReadResourceRequestSchema,
  resourceHandlers.readResource
);

// Tools handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Filter out destructive tools if ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS is set to 'true'
  const tools = nonDestructiveTools
    ? allTools.filter(
        (tool) => !destructiveTools.some((dt) => dt.name === tool.name)
      )
    : allTools;

  return { tools };
});

server.setRequestHandler(
  CallToolRequestSchema,
  async (request: {
    params: { name: string; _meta?: any; arguments?: Record<string, any> };
    method: string;
  }) => {
    try {
      const { name, arguments: input = {} } = request.params;

      // Handle new kubectl-style commands
      if (name === "kubectl_get") {
        return await kubectlGet(k8sManager, input as {
          resourceType: string;
          name?: string;
          namespace?: string;
          output?: string;
          allNamespaces?: boolean;
          labelSelector?: string;
          fieldSelector?: string;
        });
      }

      if (name === "kubectl_describe") {
        return await kubectlDescribe(k8sManager, input as {
          resourceType: string;
          name: string;
          namespace?: string;
          allNamespaces?: boolean;
        });
      }

      if (name === "kubectl_list") {
        return await kubectlList(k8sManager, input as {
          resourceType: string;
          namespace?: string;
          output?: string;
          allNamespaces?: boolean;
          labelSelector?: string;
          fieldSelector?: string;
        });
      }
      
      if (name === "kubectl_apply") {
        return await kubectlApply(k8sManager, input as {
          manifest?: string;
          filename?: string;
          namespace?: string;
          dryRun?: boolean;
          force?: boolean;
        });
      }
      
      if (name === "kubectl_delete") {
        return await kubectlDelete(k8sManager, input as {
          resourceType?: string;
          name?: string;
          namespace?: string;
          labelSelector?: string;
          manifest?: string;
          filename?: string;
          allNamespaces?: boolean;
          force?: boolean;
          gracePeriodSeconds?: number;
        });
      }

      if (name === "kubectl_create") {
        return await kubectlCreate(k8sManager, input as {
          manifest?: string;
          filename?: string;
          namespace?: string;
          dryRun?: boolean;
          validate?: boolean;
        });
      }

      // For backward compatibility, redirect to kubectl_list, kubectl_get and kubectl_describe
      switch (name) {
        case "list_pods": {
          return await kubectlList(k8sManager, {
            resourceType: "pods",
            namespace: (input as { namespace?: string }).namespace || "default",
            output: "json"
          });
        }

        case "list_deployments": {
          return await kubectlList(k8sManager, {
            resourceType: "deployments",
            namespace: (input as { namespace?: string }).namespace || "default",
            output: "json"
          });
        }

        case "list_services": {
          return await kubectlList(k8sManager, {
            resourceType: "services",
            namespace: (input as { namespace?: string }).namespace || "default",
            output: "json"
          });
        }

        case "list_nodes": {
          return await kubectlList(k8sManager, {
            resourceType: "nodes",
            output: "json"
          });
        }

        case "list_namespaces": {
          return await kubectlList(k8sManager, {
            resourceType: "namespaces",
            output: "json"
          });
        }

        case "list_cronjobs": {
          return await kubectlList(k8sManager, {
            resourceType: "cronjobs",
            namespace: (input as { namespace?: string }).namespace || "default",
            output: "json"
          });
        }

        case "describe_pod": {
          const typedInput = input as { name: string; namespace: string };
          return await kubectlDescribe(k8sManager, {
            resourceType: "pod",
            name: typedInput.name,
            namespace: typedInput.namespace
          });
        }

        case "describe_service": {
          const typedInput = input as { name: string; namespace?: string };
          return await kubectlDescribe(k8sManager, {
            resourceType: "service",
            name: typedInput.name,
            namespace: typedInput.namespace || "default"
          });
        }

        case "describe_node": {
          const typedInput = input as { name: string };
          return await kubectlDescribe(k8sManager, {
            resourceType: "node",
            name: typedInput.name
          });
        }

        case "describe_deployment": {
          const typedInput = input as { name: string; namespace: string };
          return await kubectlDescribe(k8sManager, {
            resourceType: "deployment",
            name: typedInput.name,
            namespace: typedInput.namespace
          });
        }

        case "describe_cronjob": {
          const typedInput = input as { name: string; namespace: string };
          return await kubectlDescribe(k8sManager, {
            resourceType: "cronjob",
            name: typedInput.name,
            namespace: typedInput.namespace
          });
        }

        case "get_configmap": {
          const typedInput = input as { name: string; namespace: string };
          return await kubectlGet(k8sManager, {
            resourceType: "configmap",
            name: typedInput.name,
            namespace: typedInput.namespace,
            output: "json"
          });
        }

        // Keep other operations that aren't covered by kubectl_get or kubectl_describe
        case "cleanup": {
          await k8sManager.cleanup();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "create_namespace": {
          return await createNamespace(
            k8sManager,
            input as {
              name: string;
            }
          );
        }

        case "create_pod": {
          return await createPod(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              template: string;
              command?: string[];
            }
          );
        }

        case "create_cronjob": {
          return await createCronJob(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              schedule: string;
              image: string;
              command?: string[];
              suspend?: boolean;
            }
          );
        }

        case "delete_cronjob": {
          return await DeleteCronJob(
            k8sManager,
            input as {
              name: string;
              namespace: string;
            }
          );
        }

        case "delete_pod": {
          return await deletePod(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              ignoreNotFound?: boolean;
            }
          );
        }

        case "explain_resource": {
          return await explainResource(
            input as {
              resource: string;
              apiVersion?: string;
              recursive?: boolean;
              output?: "plaintext" | "plaintext-openapiv2";
            }
          );
        }

        case "get_events": {
          return await getEvents(
            k8sManager,
            input as {
              namespace?: string;
              fieldSelector?: string;
            }
          );
        }

        case "get_logs": {
          return await getLogs(
            k8sManager,
            input as {
              resourceType: string;
              name?: string;
              namespace?: string;
              labelSelector?: string;
              container?: string;
              tail?: number;
              since?: number;
              timestamps?: boolean;
            }
          );
        }

        case "list_contexts": {
          return await listContexts(
            k8sManager,
            input as { showCurrent?: boolean }
          );
        }

        case "get_current_context": {
          return await getCurrentContext(
            k8sManager,
            input as { detailed?: boolean }
          );
        }

        case "set_current_context": {
          return await setCurrentContext(k8sManager, input as { name: string });
        }

        case "list_jobs": {
          const typedInput = input as { namespace: string; cronJobName?: string };
          
          // If cronJobName is specified, use field selector to filter
          if (typedInput.cronJobName) {
            return await kubectlList(k8sManager, {
              resourceType: "jobs",
              namespace: typedInput.namespace,
              output: "json",
              fieldSelector: `metadata.ownerReferences.name=${typedInput.cronJobName}`
            });
          }
          
          return await kubectlList(k8sManager, {
            resourceType: "jobs",
            namespace: typedInput.namespace,
            output: "json"
          });
        }

        case "get_job_logs": {
          return await getJobLogs(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              tail?: number;
              timestamps?: boolean;
            }
          );
        }

        case "install_helm_chart": {
          return await installHelmChart(
            input as {
              name: string;
              chart: string;
              repo: string;
              namespace: string;
              values?: Record<string, any>;
            }
          );
        }

        case "uninstall_helm_chart": {
          return await uninstallHelmChart(
            input as {
              name: string;
              namespace: string;
            }
          );
        }

        case "upgrade_helm_chart": {
          return await upgradeHelmChart(
            input as {
              name: string;
              chart: string;
              repo: string;
              namespace: string;
              values?: Record<string, any>;
            }
          );
        }

        case "list_api_resources": {
          return await listApiResources(
            input as {
              apiGroup?: string;
              namespaced?: boolean;
              verbs?: string[];
              output?: "wide" | "name" | "no-headers";
            }
          );
        }

        case "port_forward": {
          return await startPortForward(
            k8sManager,
            input as {
              resourceType: string;
              resourceName: string;
              localPort: number;
              targetPort: number;
            }
          );
        }

        case "stop_port_forward": {
          return await stopPortForward(
            k8sManager,
            input as {
              id: string;
            }
          );
        }

        case "delete_namespace": {
          return await deleteNamespace(
            k8sManager,
            input as {
              name: string;
              ignoreNotFound?: boolean;
            }
          );
        }

        case "delete_deployment": {
          return await deleteDeployment(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              ignoreNotFound?: boolean;
            }
          );
        }

        case "create_deployment": {
          return await createDeployment(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              template: string;
              replicas?: number;
              ports?: number[];
              customConfig?: any;
            }
          );
        }

        case "update_deployment": {
          return await updateDeployment(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              template: string;
              containerName?: string;
              replicas?: number;
              customConfig?: any;
            }
          );
        }

        case "scale_deployment": {
          return await scaleDeployment(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              replicas: number;
            }
          );
        }

        case "create_configmap": {
          return await createConfigMap(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              data: Record<string, string>;
            }
          );
        }

        case "update_configmap": {
          return await updateConfigMap(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              data: Record<string, string>;
            }
          );
        }

        case "delete_configmap": {
          return await deleteConfigMap(
            k8sManager,
            input as {
              name: string;
              namespace: string;
            }
          );
        }

        case "create_service": {
          return await createService(
            k8sManager,
            input as {
              name: string;
              namespace?: string;
              type?: "ClusterIP" | "NodePort" | "LoadBalancer";
              selector?: Record<string, string>;
              ports: Array<{
                port: number;
                targetPort?: number;
                protocol?: string;
                name?: string;
                nodePort?: number;
              }>;
            }
          );
        }

        case "update_service": {
          return await updateService(
            k8sManager,
            input as {
              name: string;
              namespace: string;
              type?: "ClusterIP" | "NodePort" | "LoadBalancer";
              selector?: Record<string, string>;
              ports?: Array<{
                port: number;
                targetPort?: number;
                protocol?: string;
                name?: string;
                nodePort?: number;
              }>;
            }
          );
        }

        case "delete_service": {
          return await deleteService(
            k8sManager,
            input as {
              name: string;
              namespace?: string;
              ignoreNotFound?: boolean;
            }
          );
        }

        default:
          throw new McpError(ErrorCode.InvalidRequest, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${error}`
      );
    }
  }
);

// Start the server
if (process.env.ENABLE_UNSAFE_SSE_TRANSPORT) {
  startSSEServer(server);
  console.log(`SSE server started`);
} else {
  const transport = new StdioServerTransport();
  
  console.log(
    `Starting Kubernetes MCP server v${serverConfig.version}, handling commands...`
  );
  
  server.connect(transport);
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, async () => {
    console.log(`Received ${signal}, shutting down...`);
    await server.close();
    process.exit(0);
  });
});

export { allTools, destructiveTools };
