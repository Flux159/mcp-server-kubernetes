import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";

export const UpdateConfigMapSchema = {
    name: "update_configmap",
    description: "Update an existing Kubernetes ConfigMap",
    inputSchema: {
        type: "object",
        properties: {
            name: { type: "string" },
            namespace: { type: "string" },
            data: {
                type: "object",
                ConfigData: { type: "string" },
            },
        },
        required: ["name", "namespace", "data"],
    },
};

export async function updateConfigMap(
    k8sManager: KubernetesManager,
    input: {
        name: string;
        namespace: string;
        data: Record<string, string>;
    }
): Promise<{ content: { success: boolean; message: string }[] }> {
    try {
        // Fetch the existing ConfigMap
        const existing = await k8sManager.getCoreApi().readNamespacedConfigMap(input.name, input.namespace);
        if (!existing.body || !existing.body.metadata) {
            return {
                content: [
                    {
                        success: false,
                        message: `ConfigMap ${input.name} in namespace ${input.namespace} not found.`,
                    },
                ],
            };
        }

        // Update the data
        const updatedConfigMap: k8s.V1ConfigMap = {
            ...existing.body,
            data: input.data,
        };

        const response = await k8sManager.getCoreApi().replaceNamespacedConfigMap(
            input.name,
            input.namespace,
            updatedConfigMap
        );

        if (
            response.response?.statusCode !== undefined &&
            (response.response.statusCode === 200 ||
                response.response.statusCode === 201 ||
                response.response.statusCode === 202)
        ) {
            return {
                content: [
                    {
                        success: true,
                        message: `Updated ConfigMap ${input.name} in namespace ${input.namespace}`,
                    },
                ],
            };
        } else {
            return {
                content: [
                    {
                        success: false,
                        message: `Failed to update ConfigMap ${input.name} in namespace ${input.namespace}`,
                    },
                ],
            };
        }
    } catch (error: any) {
        return {
            content: [
                {
                    success: false,
                    message: `Failed to update ConfigMap ${input.name} in namespace ${input.namespace}. Error: ${error.message}`,
                },
            ],
        };
    }
}
