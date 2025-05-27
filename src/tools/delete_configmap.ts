import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const DeleteConfigMapSchema = {
    name: "delete_configmap",
    description: "Delete a Kubernetes ConfigMap",
    inputSchema: {
        type: "object",
        properties: {
            name: { type: "string" },
            namespace: { type: "string" },
        },
        required: ["name", "namespace"],
    },
};

export async function deleteConfigMap(
    k8sManager: KubernetesManager,
    input: {
        name: string;
        namespace: string;
    }
): Promise<{ content: { success: boolean; message: string }[] }> {
    try {
        const response = await k8sManager.getCoreApi().deleteNamespacedConfigMap(input.name, input.namespace);
        if (
            response.response?.statusCode !== undefined &&
            (response.response.statusCode === 200 ||
                response.response.statusCode === 202)
        ) {
            return {
                content: [
                    {
                        success: true,
                        message: `Deleted ConfigMap ${input.name} in namespace ${input.namespace}`,
                    },
                ],
            };
        } else {
            return {
                content: [
                    {
                        success: false,
                        message: `Failed to delete ConfigMap ${input.name} in namespace ${input.namespace}`,
                    },
                ],
            };
        }
    } catch (error: any) {
        return {
            content: [
                {
                    success: false,
                    message: `Failed to delete ConfigMap ${input.name} in namespace ${input.namespace}. Error: ${error.message}`,
                },
            ],
        };
    }
}
