import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const GetConfigMapSchema = {
    name: "get_configmap",
    description: "Get a Kubernetes ConfigMap",
    inputSchema: {
        type: "object",
        properties: {
            name: { type: "string" },
            namespace: { type: "string" },
        },
        required: ["name", "namespace"],
    },
};

export async function getConfigMap(
    k8sManager: KubernetesManager,
    input: {
        name: string;
        namespace: string;
    }
): Promise<{ content: { success: boolean; message: string; data?: Record<string, string> }[] }> {
    try {
        const response = await k8sManager.getCoreApi().readNamespacedConfigMap(input.name, input.namespace);
        if (response.body && response.body.data) {
            return {
                content: [
                    {
                        success: true,
                        message: `Fetched ConfigMap ${input.name} in namespace ${input.namespace}`,
                        data: response.body.data,
                    },
                ],
            };
        } else {
            return {
                content: [
                    {
                        success: false,
                        message: `ConfigMap ${input.name} in namespace ${input.namespace} not found or has no data.`,
                    },
                ],
            };
        }
    } catch (error: any) {
        return {
            content: [
                {
                    success: false,
                    message: `Failed to get ConfigMap ${input.name} in namespace ${input.namespace}. Error: ${error.message}`,
                },
            ],
        };
    }
}
