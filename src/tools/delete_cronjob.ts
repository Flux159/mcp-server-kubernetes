
import { KubernetesManager } from "../types.js";

export const DeleteCronJobSchema = {
    name: "delete_cronjob",
    description: "Delete a Kubernetes CronJob",
    inputSchema: {
        type: "object",
        properties: {
            name: { type: "string" },
            namespace: { type: "string" }
        },
        required: ["name", "namespace"]
    },
} as const;

export async function DeleteCronJob(
    k8sManager: KubernetesManager,
    input: {
        name: string,
        namespace: string
    }
): Promise<{ content: { success: boolean; message: string }[] }> {
    try {
        const response = await k8sManager.getBatchApi().deleteNamespacedCronJob(input.name, input.namespace);
        if (response.response?.statusCode !== undefined && (response.response.statusCode === 200 || response.response.statusCode === 202)) {
            return {
                content: [
                    {
                        success: true,
                        message: `Deleted cronjob ${input.name} in namespace ${input.namespace}.` +
                            (response.body?.details ? ` Details: ${response.body.details}` : "")
                    }
                ]
            };
        } else {
            return {
                content: [
                    {
                        success: false,
                        message: `Failed to delete cronjob ${input.name} in namespace ${input.namespace}.` + (response.body?.details ? ` Details: ${response.body.details}` : "")
                    }
                ]
            };
        }
    } catch (error: any) {
        return {
            content: [
                {
                    success: false,
                    message: `Failed to delete cronjob: ${error.message}`
                }
            ]
        };
    }
}