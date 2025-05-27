import { KubernetesManager } from "../types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export const describeNodeSchema = {
    name: "describe_node",
    description: "Describe a Kubernetes node (read details like status, capacity, conditions, etc.)",
    inputSchema: {
        type: "object",
        properties: {
            name: { type: "string" },
        },
        required: ["name"],
    },
} as const;

export async function describeNode(k8sManager: KubernetesManager, input: {
    name: string;
}) {
    try {
        const { body } = await k8sManager.getCoreApi().readNode(input.name);

        if (!body) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                error: "Node not found",
                                status: "not_found",
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }

        // Format the node details for better readability
        const nodeDetails = {
            kind: body.kind,
            metadata: {
                name: body.metadata?.name,
                creationTimestamp: body.metadata?.creationTimestamp,
                labels: body.metadata?.labels,
                annotations: body.metadata?.annotations,
            },
            spec: {
                podCIDR: body.spec?.podCIDR,
                podCIDRs: body.spec?.podCIDRs,
                taints: body.spec?.taints,
                unschedulable: body.spec?.unschedulable,
            },
            status: {
                capacity: body.status?.capacity,
                allocatable: body.status?.allocatable,
                conditions: body.status?.conditions,
                nodeInfo: {
                    architecture: body.status?.nodeInfo?.architecture,
                    containerRuntimeVersion: body.status?.nodeInfo?.containerRuntimeVersion,
                    kernelVersion: body.status?.nodeInfo?.kernelVersion,
                    kubeletVersion: body.status?.nodeInfo?.kubeletVersion,
                    operatingSystem: body.status?.nodeInfo?.operatingSystem,
                    osImage: body.status?.nodeInfo?.osImage,
                },
                addresses: body.status?.addresses,
            },
        };

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(nodeDetails, null, 2),
                },
            ],
        };
    } catch (error: any) {
        if (error.response?.statusCode === 404) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                error: "Node not found",
                                status: "not_found",
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }
        throw new McpError(
            ErrorCode.InternalError,
            `Failed to describe node: ${error.response?.body?.message || error.message}`
        );
    }
}
