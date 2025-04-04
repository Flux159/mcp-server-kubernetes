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
import { describeCronJob, describeCronJobSchema } from "./tools/describe_cronjob.js";
import { listJobs, listJobsSchema } from "./tools/list_jobs.js";
import { getJobLogs, getJobLogsSchema } from "./tools/get_job_logs.js";
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
import { DeleteCronJob,DeleteCronJobSchema} from "./tools/delete_cronjob.js";
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
import { deleteNamespace, deleteNamespaceSchema } from "./tools/delete_namespace.js";
import { cleanupSchema } from "./config/cleanup-config.js";
import { startSSEServer } from "./utils/sse.js";
import {
  startPortForward,
  PortForwardSchema,
  stopPortForward,
  StopPortForwardSchema,
} from "./tools/port_forward.js";
import { deleteDeployment, deleteDeploymentSchema } from "./tools/delete_deployment.js";
import { createDeployment } from "./tools/create_deployment.js";
import {scaleDeployment,scaleDeploymentSchema} from "./tools/scale_deployment.js"
import {
  describeDeployment,
  describeDeploymentSchema,
} from "./tools/describe_deployment.js";
import {createConfigMap, CreateConfigMapSchema } from "./tools/create_configmap.js";

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
  return {
    tools: [
      cleanupSchema,
      createDeploymentSchema,
      createNamespaceSchema,
      createPodSchema,
      createCronJobSchema,
      deletePodSchema,
      deleteDeploymentSchema,
      deleteNamespaceSchema,
      describeCronJobSchema,
      describePodSchema,
      describeDeploymentSchema,
      explainResourceSchema,
      getEventsSchema,
      getJobLogsSchema,
      getLogsSchema,
      installHelmChartSchema,
      listApiResourcesSchema,
      listCronJobsSchema,
      listDeploymentsSchema,
      listJobsSchema,
      listNamespacesSchema,
      listNodesSchema,
      listPodsSchema,
      listServicesSchema,
      uninstallHelmChartSchema,
      upgradeHelmChartSchema,
      PortForwardSchema,
      StopPortForwardSchema,
      scaleDeploymentSchema,
      DeleteCronJobSchema,
      CreateConfigMapSchema,
    ],
  };
});

server.setRequestHandler(
  CallToolRequestSchema,
  async (request: {
    params: { name: string; _meta?: any; arguments?: Record<string, any> };
    method: string;
  }) => {
    try {
      const { name, arguments: input = {} } = request.params;

      switch (name) {
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

        case "delete_cronjob" : {
          return await DeleteCronJob(
            k8sManager,
            input as {
              name : string;
              namespace : string
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

        case "describe_pod": {
          return await describePod(
            k8sManager,
            input as {
              name: string;
              namespace: string;
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
              sinceSeconds?: number;
              timestamps?: boolean;
              pretty?: boolean;
              follow?: false;
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

        case "list_deployments": {
          return await listDeployments(
            k8sManager,
            input as { namespace?: string }
          );
        }

        case "list_namespaces": {
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
        }

        case "list_nodes": {
          return await listNodes(k8sManager);
        }

        case "list_pods": {
          return await listPods(k8sManager, input as { namespace?: string });
        }

        case "list_services": {
          return await listServices(
            k8sManager,
            input as { namespace?: string }
          );
        }

        case "list_cronjobs": {
          return await listCronJobs(
            k8sManager,
            input as { namespace?: string }
          );
        }

        case "describe_cronjob": {
          return await describeCronJob(
            k8sManager,
            input as {
              name: string;
              namespace: string;
            }
          );
        }

        case "list_jobs": {
          return await listJobs(
            k8sManager,
            input as {
              namespace: string;
              cronJobName?: string;
            }
          );
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

        case "describe_deployment": {
          return await describeDeployment(
            k8sManager,
            input as {
              name: string;
              namespace: string;
            }
          );
        }
        
        case "scale_deployment" : {
          return await scaleDeployment(
            k8sManager,
            input as {
              name : string,
              namespace : string,
             replicas : number
            }
          );
        }

        case "create_configmap" : {
          return await createConfigMap(
            k8sManager,
            input as {
              name : string,
              namespace : string,
              data : Record<string, string>
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
