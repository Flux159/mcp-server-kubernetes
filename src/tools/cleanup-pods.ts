import { execFileSync } from "child_process";
import { getSpawnMaxBuffer } from "../config/max-buffer.js";

export const cleanupPodsSchema = {
  name: "cleanup_pods",
  description: "List and optionally force delete pods in problematic states (Evicted, ContainerStatusUnknown, Completed, Error, ImagePullBackOff, CrashLoopBackOff). First lists pods, then requires explicit confirmation to delete.",
  inputSchema: {
    type: "object",
    properties: {
      namespace: {
        type: "string",
        description: "Kubernetes namespace to clean up",
      },
      dryRun: {
        type: "boolean",
        description: "Show list of problematic pods without deleting (default: true)",
        default: true,
      },
      forceDelete: {
        type: "boolean",
        description: "Force delete the problematic pods (default: false). Set to true ONLY after reviewing the list from dryRun=true",
        default: false,
      },
      allNamespaces: {
        type: "boolean",
        description: "Clean up pods in all namespaces (default: false)",
        default: false,
      },
      confirmDelete: {
        type: "boolean",
        description: "Explicit confirmation to delete pods. Must be set to true along with forceDelete=true to actually delete pods",
        default: false,
      },
    },
    required: ["namespace"],
  },
};

interface CleanupPodsParams {
  namespace: string;
  dryRun?: boolean;
  forceDelete?: boolean;
  allNamespaces?: boolean;
  confirmDelete?: boolean;
}

const executeCommand = (command: string, args: string[]): string => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 30000, // 30 seconds timeout
      maxBuffer: getSpawnMaxBuffer(),
      env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
    });
  } catch (error: any) {
    throw new Error(`${command} command failed: ${error.message}`);
  }
};

const getProblematicPods = (namespace: string, allNamespaces: boolean = false): { [key: string]: string[] } => {
  const problematicStates = [
    "Evicted",
    "ContainerStatusUnknown", 
    "Completed",
    "Error",
    "ImagePullBackOff",
    "CrashLoopBackOff"
  ];

  const results: { [key: string]: string[] } = {};
  const namespaceFlag = allNamespaces ? ["--all-namespaces"] : ["-n", namespace];

  try {
    // Get all pods
    const podsOutput = executeCommand("kubectl", ["get", "pods", ...namespaceFlag, "--no-headers"]);
    
    // Check each problematic state
    for (const state of problematicStates) {
      const matchingPods: string[] = [];
      
      // Use grep to find pods in this state
      try {
        const grepCommand = `echo '${podsOutput}' | grep "${state}" | awk '{print $1}'`;
        const podNames = execFileSync("sh", ["-c", grepCommand], {
          encoding: "utf8",
          timeout: 10000,
          maxBuffer: getSpawnMaxBuffer(),
          env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
        });
        
        if (podNames.trim()) {
          matchingPods.push(...podNames.trim().split('\n').filter(name => name.trim()));
        }
      } catch (grepError) {
        // No pods found in this state, which is fine
      }
      
      if (matchingPods.length > 0) {
        results[state] = matchingPods;
      }
    }
  } catch (error: any) {
    throw new Error(`Failed to get pods: ${error.message}`);
  }

  return results;
};

const deletePods = (podNames: string[], namespace: string, allNamespaces: boolean = false): void => {
  if (podNames.length === 0) return;

  const namespaceFlag = allNamespaces ? ["--all-namespaces"] : ["-n", namespace];
  
  for (const podName of podNames) {
    try {
      executeCommand("kubectl", [
        "delete", 
        "pod", 
        podName, 
        ...namespaceFlag,
        "--force", 
        "--grace-period=0"
      ]);
    } catch (error: any) {
      console.error(`Failed to delete pod ${podName}: ${error.message}`);
    }
  }
};

export async function cleanupPods(
  params: CleanupPodsParams
): Promise<{ content: { type: string; text: string }[] }> {
  const { namespace, dryRun = true, forceDelete = false, allNamespaces = false, confirmDelete = false } = params;

  try {
    // Get problematic pods
    const problematicPods = getProblematicPods(namespace, allNamespaces);
    
    // Count total problematic pods
    const totalPods = Object.values(problematicPods).reduce((sum, pods) => sum + pods.length, 0);
    
    let response: any = {
      namespace: allNamespaces ? "all namespaces" : namespace,
      dryRun: dryRun,
      forceDelete: forceDelete,
      confirmDelete: confirmDelete,
      totalProblematicPods: totalPods,
      podsByState: problematicPods,
    };

    if (totalPods === 0) {
      response.message = "No problematic pods found";
    } else if (dryRun) {
      response.message = `Found ${totalPods} problematic pods (dry run - no deletion performed)`;
      response.action = "To delete these pods, run again with: forceDelete=true, dryRun=false, and confirmDelete=true";
      response.nextStep = "Review the list above. If you want to delete these pods, call the tool again with the deletion parameters.";
    } else if (forceDelete && confirmDelete) {
      // Delete the pods
      for (const [state, podNames] of Object.entries(problematicPods)) {
        deletePods(podNames, namespace, allNamespaces);
      }
      response.message = `Force deleted ${totalPods} problematic pods`;
      response.action = "Pods have been force deleted with --force --grace-period=0";
    } else if (forceDelete && !confirmDelete) {
      response.message = `Found ${totalPods} problematic pods (deletion requested but not confirmed)`;
      response.action = "To actually delete these pods, set confirmDelete=true along with forceDelete=true";
      response.warning = "Deletion requires explicit confirmation. Set confirmDelete=true to proceed.";
    } else {
      response.message = `Found ${totalPods} problematic pods (no deletion performed)`;
      response.action = "To delete these pods, set forceDelete=true and confirmDelete=true";
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to cleanup pods: ${error.message}`);
  }
} 