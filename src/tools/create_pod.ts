import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  ContainerTemplate,
  containerTemplates,
  CustomContainerConfig,
  CustomContainerConfigType,
} from "../config/container-templates.js";

export const createPodSchema = {
  name: "create_pod",
  description: "Create a new Kubernetes pod",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      namespace: { type: "string" },
      template: {
        type: "string",
        enum: ContainerTemplate.options,
      },
      command: {
        type: "array",
        items: { type: "string" },
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

export async function createPod(
  k8sManager: KubernetesManager,
  input: {
    name: string;
    namespace: string;
    template: string;
    command?: string[];
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

    // Create a new container config with all fields explicitly set
    containerConfig = {
      name: "main",
      image: validatedConfig.image,
      command: validatedConfig.command,
      args: validatedConfig.args,
      ports: validatedConfig.ports || [],
      resources: validatedConfig.resources || {
        limits: {},
        requests: {},
      },
      env: validatedConfig.env || [],
      volumeMounts: validatedConfig.volumeMounts || [],
      livenessProbe: templateConfig.livenessProbe,
      readinessProbe: templateConfig.readinessProbe,
    };
  } else {
    containerConfig = {
      ...templateConfig,
      ...(input.command && {
        command: input.command,
        args: undefined, // Clear default args when command is overridden
      }),
    };
  }

  const pod: k8s.V1Pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: input.name,
      namespace: input.namespace,
      labels: {
        "mcp-managed": "true",
        app: input.name,
      },
    },
    spec: {
      containers: [containerConfig],
    },
  };

  const response = await k8sManager
    .getCoreApi()
    .createNamespacedPod(input.namespace, pod)
    .catch((error: any) => {
      console.error("Pod creation error:", {
        status: error.response?.statusCode,
        message: error.response?.body?.message || error.message,
        details: error.response?.body,
      });
      throw error;
    });

  k8sManager.trackResource("Pod", input.name, input.namespace);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            podName: response.body.metadata!.name!,
            status: "created",
          },
          null,
          2
        ),
      },
    ],
  };
}
