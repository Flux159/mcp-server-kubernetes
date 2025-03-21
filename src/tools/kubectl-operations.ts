import { execSync } from "child_process";
import {
  ExplainResourceParams,
  ListApiResourcesParams,
} from "../models/kubectl-models.js";

export const explainResourceSchema = {
  name: "explain_resource",
  description: "Get documentation for a Kubernetes resource or field",
  inputSchema: {
    type: "object",
    properties: {
      resource: {
        type: "string",
        description:
          "Resource name or field path (e.g. 'pods' or 'pods.spec.containers')",
      },
      apiVersion: {
        type: "string",
        description: "API version to use (e.g. 'apps/v1')",
      },
      recursive: {
        type: "boolean",
        description: "Print the fields of fields recursively",
        default: false,
      },
      output: {
        type: "string",
        description: "Output format (plaintext or plaintext-openapiv2)",
        enum: ["plaintext", "plaintext-openapiv2"],
        default: "plaintext",
      },
    },
    required: ["resource"],
  },
};

export const listApiResourcesSchema = {
  name: "list_api_resources",
  description: "List the API resources available in the cluster",
  inputSchema: {
    type: "object",
    properties: {
      apiGroup: {
        type: "string",
        description: "API group to filter by",
      },
      namespaced: {
        type: "boolean",
        description: "If true, only show namespaced resources",
      },
      verbs: {
        type: "array",
        items: {
          type: "string",
        },
        description: "List of verbs to filter by",
      },
      output: {
        type: "string",
        description: "Output format (wide, name, or no-headers)",
        enum: ["wide", "name", "no-headers"],
        default: "wide",
      },
    },
  },
};

export const executeKubectlCommand = (command: string): string => {
  try {
    return execSync(command, { encoding: "utf8" });
  } catch (error: any) {
    throw new Error(`Kubectl command failed: ${error.message}`);
  }
};

export async function explainResource(
  params: ExplainResourceParams
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    let command = "kubectl explain";

    if (params.apiVersion) {
      command += ` --api-version=${params.apiVersion}`;
    }

    if (params.recursive) {
      command += " --recursive";
    }

    if (params.output) {
      command += ` --output=${params.output}`;
    }

    command += ` ${params.resource}`;

    const result = executeKubectlCommand(command);

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to explain resource: ${error.message}`);
  }
}

export async function listApiResources(
  params: ListApiResourcesParams
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    let command = "kubectl api-resources";

    if (params.apiGroup) {
      command += ` --api-group=${params.apiGroup}`;
    }

    if (params.namespaced !== undefined) {
      command += ` --namespaced=${params.namespaced}`;
    }

    if (params.verbs && params.verbs.length > 0) {
      command += ` --verbs=${params.verbs.join(",")}`;
    }

    if (params.output) {
      command += ` -o ${params.output}`;
    }

    const result = executeKubectlCommand(command);

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to list API resources: ${error.message}`);
  }
}
