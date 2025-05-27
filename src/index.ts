#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { listPods, listPodsSchema } from "./tools/list_pods.js";
import { listNodes, listNodesSchema } from "./tools/list_nodes.js";
import { listServices, listServicesSchema } from "./tools/list_services.js";
import {
  listDeployments,
  listDeploymentsSchema,
} from "./tools/list_deployments.js";
import { listCronJobs, listCronJobsSchema } from "./tools/list_cronjobs.js";
import {
  describeCronJob,
  describeCronJobSchema,
} from "./tools/describe_cronjob.js";
import { listJobs, listJobsSchema } from "./tools/list_jobs.js";
import { getJobLogs, getJobLogsSchema } from "./tools/get_job_logs.js";
import { describeNode, describeNodeSchema } from "./tools/describe_node.js";
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
import { describePod, describePodSchema } from "./tools/describe_pod.js";
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
import {
  describeDeployment,
  describeDeploymentSchema,
} from "./tools/describe_deployment.js";
import {
  updateDeployment,
  updateDeploymentSchema,
} from "./tools/update_deployment.js";
import {
  createConfigMap,
  CreateConfigMapSchema,
} from "./tools/create_configmap.js";
import { getConfigMap, GetConfigMapSchema } from "./tools/get_configmap.js";
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
import {
  describeService,
  describeServiceSchema,
} from "./tools/describe_service.js";
import { updateService, updateServiceSchema } from "./tools/update_service.js";
import { deleteService, deleteServiceSchema } from "./tools/delete_service.js";

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
  cleanupSchema,
  createDeploymentSchema,
  createNamespaceSchema,
  createPodSchema,
  createCronJobSchema,
  createServiceSchema,
  deletePodSchema,
  deleteDeploymentSchema,
  deleteNamespaceSchema,
  deleteServiceSchema,
  describeCronJobSchema,
  describePodSchema,
  describeNodeSchema,
  describeDeploymentSchema,
  describeServiceSchema,
  explainResourceSchema,
  getEventsSchema,
  getJobLogsSchema,
  getLogsSchema,
  installHelmChartSchema,
  listApiResourcesSchema,
  listCronJobsSchema,
  listContextsSchema,
  getCurrentContextSchema,
  setCurrentContextSchema,
  listDeploymentsSchema,
  listJobsSchema,
  listNamespacesSchema,
  listNodesSchema,
  listPodsSchema,
  listServicesSchema,
  uninstallHelmChartSchema,
  updateDeploymentSchema,
  upgradeHelmChartSchema,
  PortForwardSchema,
  StopPortForwardSchema,
  scaleDeploymentSchema,
  DeleteCronJobSchema,
  CreateConfigMapSchema,
  updateServiceSchema,
];

// Determine the available tools at startup
const availableTools = nonDestructiveTools
  ? allTools.filter(
      (tool) => !destructiveTools.some((dt) => dt.name === tool.name)
    )
  : allTools;

const k8sManager = new KubernetesManager();

const server = new Server(
  {
    name: serverConfig.name,
    version: serverConfig.version,
  },
  serverConfig
);

// Tools handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: availableTools };
});

server.setRequestHandler(
  CallToolRequestSchema,
  async (request: {
    params: { name: string; _meta?: any; arguments?: Record<string, any> };
    method: string;
  }) => {
    try {
      const { name, arguments: input = {} } = request.params;

      // Reconstruct the conditional structure (if/else if or switch)
      if (name === "cleanup") {
        await k8sManager.cleanup();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true }, null, 2),
            },
          ],
        };
      } else if (name === "create_namespace") {
        return await createNamespace(k8sManager, input as { name: string });
      } else if (name === "create_pod") {
        return await createPod(k8sManager, input as { name: string; namespace: string; template: string; command?: string[] });
      } else if (name === "create_cronjob") {
        return await createCronJob(k8sManager, input as { name: string; namespace: string; schedule: string; image: string; command?: string[]; suspend?: boolean });
      } else if (name === "delete_cronjob") {
        return await DeleteCronJob(k8sManager, input as { name: string; namespace: string });
      } else if (name === "delete_pod") {
        return await deletePod(k8sManager, input as { name: string; namespace: string; ignoreNotFound?: boolean });
      } else if (name === "describe_pod") {
        return await describePod(k8sManager, input as { name: string; namespace: string });
      } else if (name === "describe_node") {
        return await describeNode(k8sManager, input as { name: string });
      } else if (name === "explain_resource") {
        return await explainResource(input as { resource: string; apiVersion?: string; recursive?: boolean; output?: "plaintext" | "plaintext-openapiv2" }); // No k8sManager
      } else if (name === "get_events") {
        return await getEvents(k8sManager, input as { namespace?: string; fieldSelector?: string });
      } else if (name === "get_logs") {
        return await getLogs(k8sManager, input as { resourceType: string; name?: string; namespace?: string; labelSelector?: string; container?: string; tail?: number; sinceSeconds?: number; timestamps?: boolean; pretty?: boolean; follow?: false });
      } else if (name === "install_helm_chart") {
        return await installHelmChart(input as { name: string; chart: string; repo: string; namespace: string; values?: Record<string, any> }); // No k8sManager
      } else if (name === "list_api_resources") {
        return await listApiResources(input as { apiGroup?: string; namespaced?: boolean; verbs?: string[]; output?: "wide" | "name" | "no-headers" }); // No k8sManager
      } else if (name === "list_deployments") {
        return await listDeployments(k8sManager, input as { namespace?: string });
      } else if (name === "list_namespaces") {
        const { body } = await k8sManager.getCoreApi().listNamespace();
        const namespaces = body.items.map((ns: k8s.V1Namespace) => ({
          name: ns.metadata?.name || "",
          status: ns.status?.phase || "",
          createdAt: ns.metadata?.creationTimestamp,
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ namespaces }, null, 2),
            },
          ],
        };
      } else if (name === "list_nodes") {
        return await listNodes(k8sManager); // No input arguments for listNodes
      } else if (name === "list_pods") {
        return await listPods(k8sManager, input as { namespace?: string });
      } else if (name === "list_services") {
        return await listServices(k8sManager, input as { namespace?: string });
      } else if (name === "list_cronjobs") {
        return await listCronJobs(k8sManager, input as { namespace?: string });
      } else if (name === "list_contexts") {
        return await listContexts(k8sManager, input as { showCurrent?: boolean });
      } else if (name === "get_current_context") {
        return await getCurrentContext(k8sManager, input as { detailed?: boolean });
      } else if (name === "set_current_context") {
        return await setCurrentContext(k8sManager, input as { name: string });
      } else if (name === "describe_cronjob") {
        return await describeCronJob(k8sManager, input as { name: string; namespace: string });
      } else if (name === "list_jobs") {
        return await listJobs(k8sManager, input as { namespace: string; cronJobName?: string });
      } else if (name === "get_job_logs") {
        return await getJobLogs(k8sManager, input as { name: string; namespace: string; tail?: number; timestamps?: boolean });
      } else if (name === "uninstall_helm_chart") {
        return await uninstallHelmChart(input as { name: string; namespace: string }); // No k8sManager
      } else if (name === "upgrade_helm_chart") {
        return await upgradeHelmChart(input as { name: string; chart: string; repo: string; namespace: string; values?: Record<string, any> }); // No k8sManager
      } else if (name === "port_forward") {
        return await startPortForward(k8sManager, input as { resourceType: string; resourceName: string; namespace: string; localPort: number; targetPort: number });
      } else if (name === "stop_port_forward") {
        return await stopPortForward(k8sManager, input as { id: string });
      } else if (name === "delete_namespace") {
        return await deleteNamespace(k8sManager, input as { name: string; ignoreNotFound?: boolean });
      } else if (name === "delete_deployment") {
        return await deleteDeployment(k8sManager, input as { name: string; namespace: string; ignoreNotFound?: boolean });
      } else if (name === "create_deployment") {
        return await createDeployment(k8sManager, input as { name: string; namespace: string; template: string; replicas?: number; ports?: number[]; customConfig?: any });
      } else if (name === "update_deployment") {
        return await updateDeployment(k8sManager, input as { name: string; namespace: string; template: string; containerName?: string; replicas?: number; customConfig?: any });
      } else if (name === "describe_deployment") {
        return await describeDeployment(k8sManager, input as { name: string; namespace: string });
      } else if (name === "scale_deployment") {
        return await scaleDeployment(k8sManager, input as { name: string; namespace: string; replicas: number });
      } else if (name === "create_configmap") {
        return await createConfigMap(k8sManager, input as { name: string; namespace: string; data: Record<string, string> });
      } else if (name === "get_configmap") {
        return await getConfigMap(k8sManager, input as { name: string; namespace: string });
      } else if (name === "update_configmap") {
        return await updateConfigMap(k8sManager, input as { name: string; namespace: string; data: Record<string, string> });
      } else if (name === "delete_configmap") {
        return await deleteConfigMap(k8sManager, input as { name: string; namespace: string; ignoreNotFound?: boolean });
      } else if (name === "create_service") {
        return await createService(k8sManager, input as { name: string; namespace?: string; type?: "ClusterIP" | "NodePort" | "LoadBalancer"; selector?: Record<string, string>; ports: Array<{ port: number; targetPort?: number; protocol?: string; name?: string; nodePort?: number; }> });
      } else if (name === "update_service") {
        return await updateService(k8sManager, input as { name: string; namespace: string; type?: "ClusterIP" | "NodePort" | "LoadBalancer"; selector?: Record<string, string>; ports?: Array<{ port: number; targetPort?: number; protocol?: string; name?: string; nodePort?: number; }> });
      } else if (name === "delete_service") {
        return await deleteService(k8sManager, input as { name: string; namespace?: string; ignoreNotFound?: boolean });
      } else if (name === "describe_service") {
        return await describeService(k8sManager, input as { name: string; namespace?: string });
      } else {
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

if (process.env.ENABLE_UNSAFE_SSE_TRANSPORT) {
  startSSEServer(server);
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, async () => {
    console.log(`Received ${signal}, shutting down...`);
    await server.close();
    process.exit(0);
  });
});

export { allTools, availableTools, destructiveTools };
