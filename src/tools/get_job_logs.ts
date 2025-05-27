import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const getJobLogsSchema = {
  name: "get_job_logs",
  description: "Get logs from Pods created by a specific Job",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the Job to get logs from",
      },
      namespace: {
        type: "string",
        default: "default",
      },
      tail: {
        type: "number",
        description: "Number of lines to return from the end of the logs",
        optional: true,
      },
      timestamps: {
        type: "boolean",
        description: "Include timestamps in the logs",
        optional: true,
      },
    },
    required: ["name", "namespace"],
  },
} as const;

export async function getJobLogs(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace: string;
    tail?: number;
    timestamps?: boolean;
  }
) {
  try {
    const coreApi = k8sManager.getCoreApi();

    // First, get the job to check if it exists
    const batchApi = k8sManager.getBatchApi();
    await batchApi.readNamespacedJob(input.name, input.namespace);

    // Find pods associated with this job
    const labelSelector = `job-name=${input.name}`;
    const { body: podList } = await coreApi.listNamespacedPod(
      input.namespace,
      undefined, // pretty
      undefined, // allowWatchBookmarks
      undefined, // _continue
      undefined, // fieldSelector
      labelSelector // labelSelector
    );

    if (podList.items.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: `No pods found for job ${input.name}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Get logs from all pods belonging to this job
    const podLogs = await Promise.all(
      podList.items.map(async (pod) => {
        const podName = pod.metadata?.name || "";

        try {
          const logResponse = await coreApi.readNamespacedPodLog(
            podName,
            input.namespace,
            undefined, // container
            undefined, // follow
            input.timestamps || false, // timestamps
            undefined, // sinceSeconds
            undefined, // sinceTime
            (input.tail != undefined ? true : true) || undefined, // tailLines
            undefined // pretty
          );

          return {
            podName,
            logs: logResponse.body,
            status: pod.status?.phase || "Unknown",
            startTime: pod.status?.startTime || null,
          };
        } catch (error: any) {
          return {
            podName,
            logs: `Error retrieving logs: ${error.message || "Unknown error"}`,
            status: pod.status?.phase || "Unknown",
            startTime: pod.status?.startTime || null,
          };
        }
      })
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              job: input.name,
              namespace: input.namespace,
              pods: podLogs,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    console.error("Error getting Job logs:", {
      status: error.response?.statusCode,
      message: error.response?.body?.message || error.message,
      details: error.response?.body,
    });
    throw error;
  }
}
