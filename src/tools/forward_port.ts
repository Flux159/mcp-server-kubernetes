
import {executeKubectlCommand} from "../tools/kubectl-operations.js";

import { z } from "zod";

export const PortForwardSchema = z.object({
  content : z.array(
    z.object({
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
):Promise<{content : {type : string;text:string}[]}> {
  let command = `kubectl port-forward ${input.resourceType}/${input.resourceName} ${input.localPort}:${input.targetPort}`;
  try {
    const result = executeKubectlCommand(command);
    return {
      content : [
        {
          type : "text",
          text : result
        },
      ]
    };
  } catch (error: any) {
    throw new Error(`Failed to execute portf-forward: ${error.message}`);
  }
}

