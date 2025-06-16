import { KubernetesManager } from "../types.js";
import { kubectlGet } from "./kubectl-get.js";
import { execSync } from "child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const kubectlListSchema = {
  name: "kubectl_list",
  description: "List Kubernetes resources by resource type and optionally namespace",
  inputSchema: {
    type: "object",
    properties: {
      resourceType: { 
        type: "string", 
        description: "Type of resource to list (e.g., pods, deployments, services, configmaps, etc.)" 
      },
      namespace: { 
        type: "string", 
        description: "Namespace of the resources (optional - defaults to 'default' for namespaced resources)", 
        default: "default" 
      },
      output: { 
        type: "string", 
        enum: ["json", "yaml", "wide", "name", "custom", "formatted"],
        description: "Output format - 'formatted' uses a resource-specific format with key information",
        default: "formatted" 
      },
      allNamespaces: {
        type: "boolean",
        description: "If true, list resources across all namespaces",
        default: false
      },
      labelSelector: {
        type: "string",
        description: "Filter resources by label selector (e.g. 'app=nginx')",
        optional: true
      },
      fieldSelector: {
        type: "string",
        description: "Filter resources by field selector (e.g. 'metadata.name=my-pod')",
        optional: true
      }
    },
    required: ["resourceType"],
  },
} as const;

export async function kubectlList(
  k8sManager: KubernetesManager,
  input: {
    resourceType: string;
    namespace?: string;
    output?: string;
    allNamespaces?: boolean;
    labelSelector?: string;
    fieldSelector?: string;
  }
) {
  try {
    const resourceType = input.resourceType.toLowerCase();
    const namespace = input.namespace || "default";
    const output = input.output || "formatted";
    const allNamespaces = input.allNamespaces || false;
    const labelSelector = input.labelSelector || "";
    const fieldSelector = input.fieldSelector || "";
    
    // If not using formatted output, delegate to kubectl_get
    if (output !== "formatted") {
      return await kubectlGet(k8sManager, {
        resourceType: input.resourceType,
        namespace: input.namespace,
        output: input.output,
        allNamespaces: input.allNamespaces,
        labelSelector: input.labelSelector,
        fieldSelector: input.fieldSelector
      });
    }
    
    // For formatted output, we'll use resource-specific custom columns
    let customColumns = "";
    
    switch (resourceType) {
      case "pods":
      case "pod":
      case "po":
        customColumns = "NAME:.metadata.name,NAMESPACE:.metadata.namespace,STATUS:.status.phase,NODE:.spec.nodeName,IP:.status.podIP,AGE:.metadata.creationTimestamp";
        break;
        
      case "deployments":
      case "deployment":
      case "deploy":
        customColumns = "NAME:.metadata.name,NAMESPACE:.metadata.namespace,READY:.status.readyReplicas/.status.replicas,UP-TO-DATE:.status.updatedReplicas,AVAILABLE:.status.availableReplicas,AGE:.metadata.creationTimestamp";
        break;
        
      case "services":
      case "service":
      case "svc":
        customColumns = "NAME:.metadata.name,NAMESPACE:.metadata.namespace,TYPE:.spec.type,CLUSTER-IP:.spec.clusterIP,EXTERNAL-IP:.status.loadBalancer.ingress[0].ip,PORTS:.spec.ports[*].port,AGE:.metadata.creationTimestamp";
        break;
        
      case "nodes":
      case "node":
      case "no":
        customColumns = "NAME:.metadata.name,STATUS:.status.conditions[?(@.type==\"Ready\")].status,ROLES:.metadata.labels.kubernetes\\.io/role,VERSION:.status.nodeInfo.kubeletVersion,INTERNAL-IP:.status.addresses[?(@.type==\"InternalIP\")].address,OS-IMAGE:.status.nodeInfo.osImage,KERNEL-VERSION:.status.nodeInfo.kernelVersion,CONTAINER-RUNTIME:.status.nodeInfo.containerRuntimeVersion";
        break;
        
      case "namespaces":
      case "namespace":
      case "ns":
        customColumns = "NAME:.metadata.name,STATUS:.status.phase,AGE:.metadata.creationTimestamp";
        break;
        
      case "persistentvolumes":
      case "pv":
        customColumns = "NAME:.metadata.name,CAPACITY:.spec.capacity.storage,ACCESS_MODES:.spec.accessModes,RECLAIM_POLICY:.spec.persistentVolumeReclaimPolicy,STATUS:.status.phase,CLAIM:.spec.claimRef.name,STORAGECLASS:.spec.storageClassName,AGE:.metadata.creationTimestamp";
        break;
        
      case "persistentvolumeclaims":
      case "pvc":
        customColumns = "NAME:.metadata.name,NAMESPACE:.metadata.namespace,STATUS:.status.phase,VOLUME:.spec.volumeName,CAPACITY:.status.capacity.storage,ACCESS_MODES:.spec.accessModes,STORAGECLASS:.spec.storageClassName,AGE:.metadata.creationTimestamp";
        break;
        
      case "configmaps":
      case "configmap":
      case "cm":
        customColumns = "NAME:.metadata.name,NAMESPACE:.metadata.namespace,DATA:.data,AGE:.metadata.creationTimestamp";
        break;
        
      case "secrets":
      case "secret":
        customColumns = "NAME:.metadata.name,NAMESPACE:.metadata.namespace,TYPE:.type,DATA:.data,AGE:.metadata.creationTimestamp";
        break;
        
      case "jobs":
      case "job":
        customColumns = "NAME:.metadata.name,NAMESPACE:.metadata.namespace,COMPLETIONS:.status.succeeded/.spec.completions,DURATION:.status.completionTime-(.status.startTime),AGE:.metadata.creationTimestamp";
        break;
        
      case "cronjobs":
      case "cronjob":
      case "cj":
        customColumns = "NAME:.metadata.name,NAMESPACE:.metadata.namespace,SCHEDULE:.spec.schedule,SUSPEND:.spec.suspend,ACTIVE:.status.active,LAST_SCHEDULE:.status.lastScheduleTime,AGE:.metadata.creationTimestamp";
        break;
        
      default:
        // For unknown resource types, fall back to a generic format
        customColumns = "NAME:.metadata.name,NAMESPACE:.metadata.namespace,KIND:.kind,AGE:.metadata.creationTimestamp";
        break;
    }
    
    // Build the kubectl command
    let command = "kubectl get ";
    
    // Add resource type
    command += resourceType;
    
    // Add namespace flag unless all namespaces is specified
    if (allNamespaces) {
      command += " --all-namespaces";
    } else if (namespace && !isNonNamespacedResource(resourceType)) {
      command += ` -n ${namespace}`;
    }
    
    // Add label selector if provided
    if (labelSelector) {
      command += ` -l ${labelSelector}`;
    }
    
    // Add field selector if provided
    if (fieldSelector) {
      command += ` --field-selector=${fieldSelector}`;
    }
    
    // Add custom columns format
    command += ` -o custom-columns="${customColumns}"`;
    
    // Execute the command
    try {
      const result = execSync(command, { encoding: "utf8", env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG } });
      
      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      if (error.status === 404 || error.message.includes("not found")) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Resource type ${resourceType} not found or no resources exist`,
                  status: "not_found",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list resources: ${error.message}`
      );
    }
  } catch (error: any) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute kubectl list command: ${error.message}`
    );
  }
}

// Helper function to determine if a resource is non-namespaced
function isNonNamespacedResource(resourceType: string): boolean {
  const nonNamespacedResources = [
    "nodes", "node", "no",
    "namespaces", "namespace", "ns",
    "persistentvolumes", "pv",
    "storageclasses", "sc",
    "clusterroles",
    "clusterrolebindings",
    "customresourcedefinitions", "crd", "crds"
  ];
  
  return nonNamespacedResources.includes(resourceType.toLowerCase());
} 