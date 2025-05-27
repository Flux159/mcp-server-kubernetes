
import { KubernetesManager } from "../types.js";
export const scaleDeploymentSchema = {
    name : "scale_deployment",
    description : "Scale a Kubernetes deployment",
    inputSchema : {
        type : "object",
        properties : {
            name : { type : "string" },
            namespace : { type : "string" },
            replicas : { type : "number" }
        },
        required : ["name", "namespace", "replicas"]
    }
}


export async function scaleDeployment(
    k8sManager: KubernetesManager,
    input:{
        name : string,
        namespace : string,
        replicas : number
    }
): Promise<{content : {success : boolean ; message : string}[]}> {
   try {
    const scale = k8sManager.getAppsApi().readNamespacedDeploymentScale(input.name, input.namespace);
    (await scale).body.spec!.replicas = input.replicas;
    const result = await k8sManager.getAppsApi().replaceNamespacedDeploymentScale(input.name, input.namespace, (await scale).body);
    if(result.response?.statusCode !== undefined && result.response.statusCode >= 200 && result.response.statusCode < 300) {
        return {
            content : [
                {
                    success : true,
                    message : `Scaled deployment ${input.name} to ${input.replicas} replicas`
                }
            ]
        }
    }
    else{
        return {
            content : [
                {
                    success : false,
                    message : `Failed to scale deployment ${input.name} to ${input.replicas} replicas`
                }
            ]
        }
    }
   } catch (error : any) {
    return{
        content : [
            {
            success : false,
            message : `Failed to scale deployment ${error.message}`
            }
        ]
    }
   }
}

  