import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const listJobsSchema = {
  name: "list_jobs",
  description:
    "List Jobs in a namespace, optionally filtered by a CronJob parent",
  inputSchema: {
    type: "object",
    properties: {
      namespace: { type: "string", default: "default" },
      cronJobName: {
        type: "string",
        description: "Optional: Filter jobs created by a specific CronJob",
        optional: true,
      },
    },
    required: ["namespace"],
  },
} as const;

export async function listJobs(
  k8sManager: KubernetesManager,
  input: {
    namespace: string;
    cronJobName?: string;
  }
) {
  try {
    const namespace = input.namespace;
    const batchV1Api = k8sManager.getBatchApi();

    // Set up label selector if cronJobName is provided
    let labelSelector;
    if (input.cronJobName) {
      labelSelector = `cronjob-name=${input.cronJobName}`;
    }

    // Get jobs with optional filtering
    const { body } = await batchV1Api.listNamespacedJob(
      namespace,
      undefined, // pretty
      undefined, // allowWatchBookmarks
      undefined, // _continue
      undefined, // fieldSelector
      labelSelector // labelSelector
    );

    // Sort jobs by creation time (newest first)
    const jobs = body.items.sort((a, b) => {
      const aTime = a.metadata?.creationTimestamp
        ? new Date(a.metadata.creationTimestamp)
        : new Date(0);
      const bTime = b.metadata?.creationTimestamp
        ? new Date(b.metadata.creationTimestamp)
        : new Date(0);
      return bTime.getTime() - aTime.getTime();
    });

    // Transform job data to a more readable format
    const formattedJobs = jobs.map((job) => ({
      name: job.metadata?.name || "",
      namespace: job.metadata?.namespace || "",
      creationTime: job.metadata?.creationTimestamp || "",
      labels: job.metadata?.labels || {},
      completions: job.spec?.completions || 1,
      parallelism: job.spec?.parallelism || 1,
      status: {
        active: job.status?.active || 0,
        succeeded: job.status?.succeeded || 0,
        failed: job.status?.failed || 0,
        completionTime: job.status?.completionTime || null,
        startTime: job.status?.startTime || null,
        conditions: job.status?.conditions || [],
      },
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ jobs: formattedJobs }, null, 2),
        },
      ],
    };
  } catch (error: any) {
    console.error("Error listing Jobs:", {
      status: error.response?.statusCode,
      message: error.response?.body?.message || error.message,
      details: error.response?.body,
    });
    throw error;
  }
}
