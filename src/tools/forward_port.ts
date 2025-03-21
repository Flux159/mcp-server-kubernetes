import { exec, execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { KubernetesManager } from "../types.js";

export const PortForwardSchema = {
  name: "port forward",
  description: "Forward network traffic from a Kubernetes resource to a local port",
  inputSchema: {
    type: "object",
    properties: {
      resourceType: { 
        type: "string",
        enum: ["pod", "svc"],
        description: "The Kubernetes resource type (pod or service)"
      },
      resourceName: { 
        type: "string",
        description: "The name of the Kubernetes pod or service"
      },
      localPort: { 
        type: "number",
        minimum: 1,
        maximum: 65535,
        description: "The local machine port to forward traffic to"
      },
      targetPort: { 
        type: "number",
        minimum: 1,
        maximum: 65535,
        description: "The port on the Kubernetes resource to forward traffic from"
      }
    },
    required: ["resourceType", "resourceName", "localPort", "targetPort"]
  }
} as const;

const PID_FILE = "port-forward.pid";

export async function startForwardPort(
  k8sManager: KubernetesManager, 
  input: {
    resourceType: string;
    resourceName: string;
    localPort: number;
    targetPort: number;
  }
): Promise<void> {
  const { resourceType, resourceName, localPort, targetPort } = input;
  const command = `kubectl port-forward ${resourceType}/${resourceName} ${localPort}:${targetPort} & echo $! > ${PID_FILE}`;

  try {
    console.log(`Executing: ${command}`);

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing port-forward: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`);
        return;
      }
      console.log(`stdout: ${stdout}`);
    });

  } catch (error) {
    console.error(`Unexpected error: ${(error as Error).message}`);
  }
}

export async function stopPortForward(): Promise<void>{
  try {
    if (!existsSync(PID_FILE)) {
      console.error("No active port-forwarding process found.");
      return;
    }

    const pid = readFileSync(PID_FILE, "utf-8").trim();
    console.log(`Stopping port-forward process with PID: ${pid}`);

    execSync(`kill ${pid}`);
    unlinkSync(PID_FILE); 

    console.log("Port-forwarding stopped successfully.");
  } catch (error) {
    console.error(`Error stopping port-forward: ${(error as Error).message}`);
  }
}
