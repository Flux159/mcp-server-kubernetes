import { KubernetesManager } from "../types.js";

export const describeCronJobSchema = {
  name: "describe_cronjob",
  description:
    "Get detailed information about a Kubernetes CronJob including recent job history",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string", default: "default" },
    },
    required: ["name", "namespace"],
  },
} as const;

export async function describeCronJob(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace: string;
  }
) {
  try {
    // Get the CronJob details
    const batchV1Api = k8sManager.getBatchApi();
    const cronJobResponse = await batchV1Api.readNamespacedCronJob(
      input.name,
      input.namespace
    );
    const cronJob = cronJobResponse.body;

    // Get recent Jobs associated with this CronJob
    const labelSelector = `app=${input.name},cronjob-name=${input.name}`;
    const jobsResponse = await batchV1Api.listNamespacedJob(
      input.namespace,
      undefined, // pretty
      undefined, // allowWatchBookmarks
      undefined, // _continue
      undefined, // fieldSelector
      labelSelector
    );

    // Sort jobs by creation time (newest first)
    const jobs = jobsResponse.body.items.sort((a, b) => {
      const aTime = a.metadata?.creationTimestamp
        ? new Date(a.metadata.creationTimestamp)
        : new Date(0);
      const bTime = b.metadata?.creationTimestamp
        ? new Date(b.metadata.creationTimestamp)
        : new Date(0);
      return bTime.getTime() - aTime.getTime();
    });

    // Limit to 5 most recent jobs
    const recentJobs = jobs.slice(0, 5).map((job) => ({
      name: job.metadata?.name || "",
      creationTime: job.metadata?.creationTimestamp || "",
      status: {
        active: job.status?.active || 0,
        succeeded: job.status?.succeeded || 0,
        failed: job.status?.failed || 0,
        completionTime: job.status?.completionTime || null,
      },
    }));

    // Format the response with CronJob details and recent jobs
    const cronJobDetails = {
      name: cronJob.metadata?.name || "",
      namespace: cronJob.metadata?.namespace || "",
      schedule: cronJob.spec?.schedule || "",
      suspend: cronJob.spec?.suspend || false,
      concurrencyPolicy: cronJob.spec?.concurrencyPolicy || "Allow",
      lastScheduleTime: cronJob.status?.lastScheduleTime || null,
      lastSuccessfulTime: cronJob.status?.lastSuccessfulTime || null,
      creationTimestamp: cronJob.metadata?.creationTimestamp || "",
      recentJobs: recentJobs,
      jobTemplate: {
        image:
          cronJob.spec?.jobTemplate?.spec?.template?.spec?.containers?.[0]
            ?.image || "",
        command:
          cronJob.spec?.jobTemplate?.spec?.template?.spec?.containers?.[0]
            ?.command || [],
        restartPolicy:
          cronJob.spec?.jobTemplate?.spec?.template?.spec?.restartPolicy || "",
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(cronJobDetails, null, 2),
        },
      ],
    };
  } catch (error: any) {
    console.error("Error describing CronJob:", {
      status: error.response?.statusCode,
      message: error.response?.body?.message || error.message,
      details: error.response?.body,
    });
    throw error;
  }
}
