import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";
export const CreateConfigMapSchema = {
    name : "create_configmap",
    description :  "Create a new Kubernetes ConfigMap",
    inputSchema : {
        type : "object",
        properties : {
            name : { type : "string" },
            namespace : { type : "string" },
            data : {
                type : "object",
                ConfigData : { type : "string" },
            },
        },
        required : ["name", "namespace", "data"],
    },
};

export async function createConfigMap(
    k8sManager : KubernetesManager,
    input : {
        name : string;
        namespace : string;
        data : Record<string, string>;
    }
): Promise<{ content: { success: boolean; message: string}[] }> {
    try {
        const configmap : k8s.V1ConfigMap = {
            apiVersion : "v1",
            kind : "ConfigMap",
            binaryData : undefined,
            data : input.data,
            immutable : false,
            metadata : {
                name : input.name,
                namespace : input.namespace,
                labels : {
                    "mcp-managed" : "true",
                    app : input.name,
                },
            },
        }
        const response = await k8sManager.getCoreApi().createNamespacedConfigMap(input.namespace, configmap);
        if(response.response?.statusCode !== undefined && (response.response.statusCode == 200 || response.response.statusCode == 201 || response.response.statusCode == 202)) {
            return {
                content : [
                    {
                        success : true,
                        message : `Created ConfigMap ${response.body.metadata?.name} in namespace ${response.body.metadata?.namespace}`,
                    }
                ]
            }
        }
        else {
            return {
                content : [
                    {
                        success : false,
                        message : `Failed to create ConfigMap ${response.body.metadata?.name} in namespace ${response.body.metadata?.namespace}`,
                    }
                ]
        }
    }
    } catch (error : any) {
        return {
            content : [
                {
                    success : false,
                    message : `Failed to create ConfigMap ${input.name} in namespace ${input.namespace}. Error: ${error.message}`,
                }
            ]
        };
    }
}