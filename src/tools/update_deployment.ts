import { KubernetesManager } from "../types.js";
import * as k8s from "@kubernetes/client-node";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  ContainerTemplate,
  containerTemplates,
  CustomContainerConfig,
  CustomContainerConfigType,
} from "../config/container-templates.js";

export const updateDeploymentSchema = {
  name: "update_deployment",
  description: "Update an existing kubernetes deployment in cluster",
  inputSchema: {
    type: "object",
    required: ["name", "namespace", "template"],
    properties: {
      name: { type: "string" },
      namespace: { type: "string" },
      template: {
        type: "string",
        enum: ContainerTemplate.options,
      },
      containerName: {
        type: "string",
        description: "Name of the container to update",
      },
      replicas: { type: "number" },
      customConfig: {
        type: "object",
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
        },
      },
    },
  },
};

export async function updateDeployment(
  k8sManager: KubernetesManager,
  params: {
    name: string;
    namespace: string;
    template: string;
    containerName?: string;
    replicas?: number;
    customConfig?: CustomContainerConfigType;
  }
) {
  // Get existing deployment
  const { body: existingDeployment } = await k8sManager
    .getAppsApi()
    .readNamespacedDeployment(params.name, params.namespace)
    .catch((error: any) => {
      console.error("Deployment read error:", {
        status: error.response?.statusCode,
        message: error.response?.body?.message || error.message,
        details: error.response?.body,
      });
      throw error;
    });

  // Find target container
  const containers = existingDeployment.spec!.template.spec!.containers;
  let targetContainerIndex = params.containerName 
    ? containers.findIndex(c => c.name === params.containerName)
    : 0;

  if (targetContainerIndex === -1) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Container '${params.containerName}' not found in deployment`
    );
  }

  // Prepare container config
  const templateConfig = containerTemplates[params.template];
  let containerConfig: k8s.V1Container;

  if (params.template === "custom") {
    if (!params.customConfig) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Custom container configuration is required when using 'custom' template"
      );
    }

    const validatedConfig = CustomContainerConfig.parse(params.customConfig);
    containerConfig = {
      ...containers[targetContainerIndex],
      ...templateConfig,
      image: validatedConfig.image,
      command: validatedConfig.command,
      args: validatedConfig.args,
      ports: validatedConfig.ports,
      resources: validatedConfig.resources,
      env: validatedConfig.env,
    };
  } else {
    containerConfig = {
      ...containers[targetContainerIndex],
      ...templateConfig,
    };
  }

  // Update deployment
  const updatedContainers = [...containers];
  updatedContainers[targetContainerIndex] = containerConfig;

  const updatedDeployment: k8s.V1Deployment = {
    ...existingDeployment,
    spec: {
      ...existingDeployment.spec!,
      replicas: params.replicas ?? existingDeployment.spec!.replicas,
      template: {
        ...existingDeployment.spec!.template,
        spec: {
          ...existingDeployment.spec!.template.spec,
          containers: updatedContainers,
        },
      },
    },
  };

  const { body } = await k8sManager
    .getAppsApi()
    .replaceNamespacedDeployment(params.name, params.namespace, updatedDeployment)
    .catch((error) => {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update deployment: ${error}`
      );
    })
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            message: "Deployment updated successfully",
            deployment: {
              name: body.metadata?.name,
              namespace: body.metadata?.namespace,
              replicas: body.spec?.replicas,
              image: body.spec?.template.spec?.containers[targetContainerIndex].image,
              containerName: body.spec?.template.spec?.containers[targetContainerIndex].name,
            },
          },
          null,
          2
        ),
      },
    ],
  };
}