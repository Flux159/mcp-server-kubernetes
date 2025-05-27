import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const listCronJobsSchema = {
  name: "list_cronjobs",
  description: "List CronJobs in a namespace",
  inputSchema: {
    type: "object",
    properties: {
      namespace: { type: "string", default: "default" },
    },
    required: ["namespace"],
  },
} as const;

export async function listCronJobs(
  k8sManager: KubernetesManager,
  input: { namespace?: string }
) {
  const namespace = input.namespace || "default";
  
  // Get BatchV1Api from KubernetesManager
  const batchV1Api = k8sManager.getBatchApi();
  
  // List cronjobs in the specified namespace
  const { body } = await batchV1Api.listNamespacedCronJob(namespace);

  // Transform cronjob data to a more readable format
  const cronjobs = body.items.map((cronjob) => ({
    name: cronjob.metadata?.name || "",
    namespace: cronjob.metadata?.namespace || "",
    schedule: cronjob.spec?.schedule || "",
    suspend: cronjob.spec?.suspend || false,
    lastScheduleTime: cronjob.status?.lastScheduleTime || null,
    createdAt: cronjob.metadata?.creationTimestamp,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ cronjobs }, null, 2),
      },
    ],
  };
}