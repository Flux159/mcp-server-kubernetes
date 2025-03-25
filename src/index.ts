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
import { createPod, createPodSchema } from "./tools/create_pod.js";
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
import { cleanupSchema } from "./config/cleanup-config.js";
import { startForwardPort,PortForwardSchema } from "./tools/forward_port.js";
import { startSSEServer } from "./utils/sse.js";

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
      createPodSchema,
      deletePodSchema,
      describePodSchema,
      explainResourceSchema,
      getEventsSchema,
      getLogsSchema,
      installHelmChartSchema,
      listApiResourcesSchema,
      listDeploymentsSchema,
      listNamespacesSchema,
      listNodesSchema,
      listPodsSchema,
      listServicesSchema,
      uninstallHelmChartSchema,
      upgradeHelmChartSchema,
      PortForwardSchema
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

        case "start_forwardport": {
          return await startForwardPort(
            input as {
              resourceType: string;
              resourceName: string;
              localPort: number;
              targetPort: number;
            }
          )
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
