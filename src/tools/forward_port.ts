
import {executeKubectlCommand} from "../tools/kubectl-operations.js";

import { z } from "zod";

export const PortForwardSchema = z.object({
  content : z.array(
    z.object({
   type: z.literal("port-forward"),
   resourceType: z.string(),
   resourceName: z.string(),
   localPort: z.number(),
   targetPort: z.number(),
  }),
  ),
});

export async function startForwardPort(
  input: {
    resourceType: string;
    resourceName: string;
    localPort: number;
    targetPort: number;
  }
):Promise<{content : {success: boolean, message: string}[]}> {
  let command = `kubectl port-forward ${input.resourceType}/${input.resourceName} ${input.localPort}:${input.targetPort}`;
  try {
    const result = executeKubectlCommand(command);
    if(result.includes("Forwarding from")){
      return {
        content: [
          {
            success: true,
            message: "port-forwarding was successful",
          },
        ],
      };
    } else {
      return {
        content: [
          {
            success: false,
            message: "port-forwarding failed",
          },
        ],
    }
    };} catch (error: any) {
    throw new Error(`Failed to execute portf-forward: ${error.message}`);
  }
}
