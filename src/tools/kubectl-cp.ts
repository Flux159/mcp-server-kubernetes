import { getSpawnMaxBuffer } from "../config/max-buffer.js";
import { KubernetesManager } from "../types.js";
import { execFileSync } from "child_process";

export const kubectlCopySchema = {
  name: "kubectl_cp",
  description:
    "Copy files between a local machine and a Kubernetes pod or between two pods",
  inputSchema: {
    type: "object",
    properties: {
      sourceFilePath: {
        type: "string",
        description:
          "Source file or directory to copy. Can be local path or pod:path/to/file",
      },
      destinationFilePath: {
        type: "string",
        description:
          "Destination file or directory to copy to. Can be local path or pod:path/to/file",
      },
      container: {
        type: "string",
        description:
          "Optional. The name of the container in the pod to copy files to or from. If not specified, defaults to the first container in the pod.",
      },
    },
    required: ["sourceFilePath", "destinationFilePath"],
  },
} as const;

export async function kubectlCp(
  k8sManager: KubernetesManager,
  input: {
    sourceFilePath: string;
    destinationFilePath: string;
    container?: string;
  }
) {
  const { sourceFilePath, destinationFilePath } = input;

  try {
    const command = "kubectl";
    let args = ["cp"];

    if (!sourceFilePath || !destinationFilePath) {
      throw new Error(
        "Both sourceFilePath and destinationFilePath are required."
      );
    }

    args.push(sourceFilePath.trim(), destinationFilePath.trim());

    if (input.container) {
      args.push(`-c`, input.container); // Fixed: separate argument for container
    }

    try {
      const result = execFileSync(command, args, {
        encoding: "utf8",
        maxBuffer: getSpawnMaxBuffer(),
        env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
      });
      
      return {
        content: [
          {
            type: "text",
            text: `File copied from ${sourceFilePath} to ${destinationFilePath} successfully.`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to copy file: ${errorMessage}`);
    }
  } catch (error) {
    console.error("Error during kubectl cp:", error);
    throw error;
  }
}