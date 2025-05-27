import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  ContainerTemplate,
  containerTemplates,
  CustomContainerConfig,
  CustomContainerConfigType,
} from "../config/container-templates.js";

export const createDeploymentSchema = {
  name: "create_deployment",
  description: "Create a new Kubernetes deployment",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string" },
      template: {
        type: "string",
        enum: ContainerTemplate.options,
      },
      replicas: { type: "number", default: 1 },
      ports: {
        type: "array",
        items: { type: "number" },
        optional: true,
      },
      customConfig: {
        type: "object",
        optional: true,
        properties: {
          image: { type: "string" },
          command: { type: "array", items: { type: "string" } },
          args: { type: "array", items: { type: "string" } },
          ports: {
            type: "array",
            items: {
              type: "object",
              properties: {
                containerPort: { type: "number" },
                name: { type: "string" },
                protocol: { type: "string" },
              },
            },
          },
          resources: {
            type: "object",
            properties: {
              limits: {
                type: "object",
                additionalProperties: { type: "string" },
              },
              requests: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
          },
          env: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: { type: "string" },
                valueFrom: { type: "object" },
              },
            },
          },
          volumeMounts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                mountPath: { type: "string" },
                readOnly: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    required: ["name", "namespace", "template"],
  },
} as const;

export async function createDeployment(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace: string;
    template: string;
    replicas?: number;
    ports?: number[];
    customConfig?: CustomContainerConfigType;
  }
) {
  const templateConfig = containerTemplates[input.template];

  // If using custom template, validate and merge custom config
  let containerConfig: k8s.V1Container;
  if (input.template === "custom") {
    if (!input.customConfig) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Custom container configuration is required when using 'custom' template"
      );
    }

    // Validate custom config against schema
    const validatedConfig = CustomContainerConfig.parse(input.customConfig);

    // Merge base template with custom config
    containerConfig = {
      ...templateConfig,
      image: validatedConfig.image,
      command: validatedConfig.command,
      args: validatedConfig.args,
      ports: validatedConfig.ports,
      resources: validatedConfig.resources,
      env: validatedConfig.env,
      volumeMounts: validatedConfig.volumeMounts,
    };
  } else {
    containerConfig = {
      ...templateConfig,
      ports:
        input.ports?.map((port) => ({ containerPort: port })) ||
        templateConfig.ports,
    };
  }

  const deployment: k8s.V1Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: input.name,
      namespace: input.namespace,
      labels: {
        "mcp-managed": "true",
        app: input.name,
      },
    },
    spec: {
      replicas: input.replicas || 1,
      selector: {
        matchLabels: {
          app: input.name,
        },
      },
      template: {
        metadata: {
          labels: {
            app: input.name,
          },
        },
        spec: {
          containers: [containerConfig],
        },
      },
    },
  };

  const response = await k8sManager
    .getAppsApi()
    .createNamespacedDeployment(input.namespace, deployment)
    .catch((error: any) => {
      console.error("Deployment creation error:", {
        status: error.response?.statusCode,
        message: error.response?.body?.message || error.message,
        details: error.response?.body,
      });
      throw error;
    });

  k8sManager.trackResource("Deployment", input.name, input.namespace);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            deploymentName: response.body.metadata!.name!,
            status: "created",
          },
          null,
          2
        ),
      },
    ],
  };
}
