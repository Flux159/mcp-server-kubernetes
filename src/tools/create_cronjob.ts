import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const createCronJobSchema = {
  name: "create_cronjob",
  description: "Create a new Kubernetes CronJob",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string" },
      schedule: { type: "string" },
      image: { type: "string" },
      command: {
        type: "array",
        items: { type: "string" },
        optional: true,
      },
      suspend: {
        type: "boolean",
        optional: true,
      },
    },
    required: ["name", "namespace", "schedule", "image"],
  },
} as const;

export async function createCronJob(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace: string;
    schedule: string;
    image: string;
    command?: string[];
    suspend?: boolean;
  }
) {
  try {
    const cronJob: k8s.V1CronJob = {
      apiVersion: "batch/v1",
      kind: "CronJob",
      metadata: {
        name: input.name,
        namespace: input.namespace,
        labels: {
          "mcp-managed": "true",
          app: input.name,
        },
      },
      spec: {
        schedule: input.schedule,
        suspend: input.suspend || false,
        jobTemplate: {
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    name: input.name,
                    image: input.image,
                    ...(input.command && {
                      command: input.command,
                    }),
                  },
                ],
                restartPolicy: "OnFailure",
              },
            },
          },
        },
      },
    };

    const response = await k8sManager
      .getBatchApi()
      .createNamespacedCronJob(input.namespace, cronJob)
      .catch((error: any) => {
        console.error("CronJob creation error:", {
          status: error.response?.statusCode,
          message: error.response?.body?.message || error.message,
          details: error.response?.body,
        });
        throw error;
      });

    k8sManager.trackResource("CronJob", input.name, input.namespace);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              cronJobName: response.body.metadata!.name!,
              schedule: response.body.spec!.schedule!,
              status: "created",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    console.error("CronJob creation error:", {
      status: error.response?.statusCode,
      message: error.response?.body?.message || error.message,
      details: error.response?.body,
    });
    throw error;
  }
}