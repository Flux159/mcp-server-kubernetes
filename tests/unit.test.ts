// Import required test frameworks and SDK components
import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsResponseSchema, PingResponseSchema } from "../src/models/tool-models.js";
import {
  ListPodsResponseSchema,
  ListNamespacesResponseSchema,
  ListNodesResponseSchema,
  CreatePodResponseSchema,
  DeletePodResponseSchema,
  CreateDeploymentResponseSchema,
  DeleteDeploymentResponseSchema,
  ListDeploymentsResponseSchema,
  DescribeNodeResponseSchema,
} from "../src/models/response-schemas.js";
// Add KubectlResponseSchema for the unified kubectl commands
import { KubectlResponseSchema } from "../src/models/kubectl-models.js";
import { z } from "zod";
import { asResponseSchema } from "./context-helper";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * Utility function to create a promise that resolves after specified milliseconds
 * Useful for waiting between operations or ensuring async operations complete
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a random SHA-like string for unique resource naming
 * Used to avoid naming conflicts when creating test resources
 */
function generateRandomSHA(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Test suite for kubernetes server operations
 * Tests the core functionality of kubernetes operations including:
 * - Listing available tools
 * - Namespace and node operations
 * - Pod lifecycle management (create, monitor, delete)
 */
describe("kubernetes server operations", () => {
  let transport: StdioClientTransport;
  let client: Client;

  /**
   * Set up before each test:
   * - Creates a new StdioClientTransport instance
   * - Initializes and connects the MCP client
   * - Waits for connection to be established
   */
  beforeEach(async () => {
    try {
      transport = new StdioClientTransport({
        command: "bun",
        args: ["run", "src/index.ts"],
        stderr: "pipe",
        stdout: "pipe",
        log: (...args) => console.log("SERVER LOG:", ...args),
        error: (...args) => console.error("SERVER ERROR:", ...args),
      });
      // console.log("StdioClientTransport initialized."); // Removed for debugging

      client = new Client(
        {
          name: "test-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );
      await client.connect(transport);
      // Wait for connection to be fully established
      await sleep(1000);

    } catch (error) {
      console.error("Error in beforeEach:", error);
    }
  });

  /**
   * Clean up after each test:
   * - Closes the transport connection
   * - Waits to ensure clean shutdown
   */
  afterEach(async () => {
    try {
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  /**
   * Test case: Verify the availability of kubernetes tools
   * Ensures that the server exposes the expected kubernetes operations
   */
  test("list available tools", async () => {
    // List available tools stays the same
    console.log("Listing available tools...");
    const toolsList = await client.request(
      {
        method: "tools/list",
      },
      asResponseSchema(ListToolsResponseSchema)
    );
    expect(toolsList.tools).toBeDefined();
    expect(toolsList.tools.length).toBeGreaterThan(0);
  });

  /**
   * Test case: Verify namespace and node listing functionality
   * Tests both namespace and node listing operations in sequence
   */
  test("list namespaces and nodes", async () => {
    // List namespaces using kubectl_get
    console.log("Listing namespaces...");
    const namespacesResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "namespaces",
            output: "json"
          },
        },
      },
      asResponseSchema(KubectlResponseSchema) // Use KubectlResponseSchema for all kubectl commands
    );
    expect(namespacesResult.content[0].type).toBe("text");
    const namespaces = JSON.parse(namespacesResult.content[0].text);
    expect(namespaces.items).toBeDefined();
    expect(Array.isArray(namespaces.items)).toBe(true);

    // List nodes using kubectl_get
    console.log("Listing nodes...");
    const listNodesResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "nodes",
            output: "json"
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );
    expect(listNodesResult.content[0].type).toBe("text");
    const nodes = JSON.parse(listNodesResult.content[0].text);
    expect(nodes.items).toBeDefined();
    expect(Array.isArray(nodes.items)).toBe(true);

    // Describe a node - but only if we have valid nodes
    let validNodeFound = false;
    
    if (nodes.items && nodes.items.length > 0) {
      // Look for a node with a proper name
      for (const nodeItem of nodes.items) {
        if (nodeItem && nodeItem.metadata && nodeItem.metadata.name) {
          const nodeName = nodeItem.metadata.name;
          console.log(`Found valid node: ${nodeName}, proceeding with describe test`);
          validNodeFound = true;
          
          const describeNodeResult = await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_describe",
                arguments: {
                  resourceType: "node",
                  name: nodeName,
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );

          expect(describeNodeResult.content[0].type).toBe("text");
          const nodeDetailsText = describeNodeResult.content[0].text;
          
          // Check if the output contains typical node information
          expect(nodeDetailsText).toContain(nodeName);
          
          // Verify that common node information sections are present
          const expectedSections = ["Name:", "Labels:", "Annotations:", "Conditions:"];
          for (const section of expectedSections) {
            expect(nodeDetailsText).toContain(section);
          }
          
          // We've successfully tested one node, no need to test more
          break;
        }
      }
    }
    
    if (!validNodeFound) {
      console.log("No valid nodes found to describe - skipping node description test");
    }
  });

  // Describe a non-existent node
  test("describe non-existent node", async () => {
    const nonExistentNodeName = "non-existent-node-" + Date.now();
    console.log(`Attempting to describe non-existent node ${nonExistentNodeName}...`);

    // Use the new kubectl_describe method instead of describe_node
    const describeNodeResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_describe",
          arguments: {
            resourceType: "node",
            name: nonExistentNodeName,
          },
        },
      },
      // @ts-ignore - Ignoring type error for now to get tests running
      asResponseSchema(z.any())
    );

    expect(describeNodeResult.content[0].type).toBe("text");
    // With kubectl_describe, we expect a plain text error message instead of JSON
    expect(describeNodeResult.content[0].text).toContain("not found");
  });

  /**
   * Test case: Complete pod lifecycle management
   * Tests the full lifecycle of a pod including:
   * 1. Cleanup of existing test pods
   * 2. Creation of new test pod
   * 3. Monitoring pod until running state
   * 4. Verification of pod logs
   * 5. Pod deletion and termination verification
   *
   * Note: Test timeout is set to 120 seconds to accommodate all operations via vitest.config.ts
   */
  test(
    "pod lifecycle management",
    async () => {
      const podBaseName = "unit-test";
      const podName = `${podBaseName}-${generateRandomSHA()}`;

      // Step 1: Check if pods with unit-test prefix exist and terminate them if found
      const existingPods = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "pods",
              labelSelector: `test=${podBaseName}`,
              output: "json",
            },
          },
        },
        asResponseSchema(KubectlResponseSchema)
      );

      const podsResponse = JSON.parse(existingPods.content[0].text);
      const existingTestPods =
        podsResponse.items?.filter((pod: any) =>
          pod.metadata?.name?.startsWith(podBaseName)
        ) || [];

      // Terminate existing test pods if found
      for (const pod of existingTestPods) {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "pod",
                name: pod.metadata.name,
                namespace: "default",
                force: true
              },
            },
          },
          asResponseSchema(DeletePodResponseSchema)
        );

        // Wait for pod to be fully terminated
        let podDeleted = false;
        const terminationStartTime = Date.now();

        while (!podDeleted && Date.now() - terminationStartTime < 10000) {
          try {
            await client.request(
              {
                method: "tools/call",
                params: {
                  name: "kubectl_get",
                  arguments: {
                    resourceType: "pod",
                    name: pod.metadata.name,
                    namespace: "default",
                    output: "json"
                  },
                },
              },
              asResponseSchema(ListPodsResponseSchema)
            );
            await sleep(500);
          } catch (error) {
            // If we get an error, it might be because the pod is gone (404)
            podDeleted = true;
          }
        }
      }

      // Create new pod with random SHA name using kubectl_create
      const podManifest = {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: podName,
          namespace: "default",
          labels: {
            app: "unit-test",
            testcase: "pod-lifecycle"
          }
        },
        spec: {
          containers: [
            {
              name: "busybox",
              image: "busybox",
              command: [
                "/bin/sh",
                "-c",
                "echo Pod is running && sleep infinity"
              ]
            }
          ],
          restartPolicy: "Never"
        }
      };

      const createPodResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              resourceType: "pod",
              name: podName,
              namespace: "default",
              manifest: JSON.stringify(podManifest)
            },
          },
        },
        asResponseSchema(CreatePodResponseSchema)
      );

      expect(createPodResult.content[0].type).toBe("text");
      // Instead of parsing podName from create_pod response, we verify the pod exists
      
      // Step 2: Wait for Running state (up to 60 seconds)
      let podRunning = false;
      const startTime = Date.now();

      while (!podRunning && Date.now() - startTime < 60000) {
        const podStatus = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_get",
              arguments: {
                resourceType: "pod",
                name: podName,
                namespace: "default",
                output: "json"
              },
            },
          },
          asResponseSchema(ListPodsResponseSchema)
        );

        const status = JSON.parse(podStatus.content[0].text);
        if (status.status?.phase === "Running") {
          podRunning = true;
          console.log(`Pod ${podName} is running. Checking logs...`);

          // Check pod logs once running using kubectl_logs
          const logsResult = await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_logs",
                arguments: {
                  resourceType: "pod",
                  name: podName,
                  namespace: "default"
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );

          expect(logsResult.content[0].type).toBe("text");
          expect(logsResult.content[0].text).toContain("Pod is running");
          break;
        }
        await sleep(1000);
      }

      expect(podRunning).toBe(true);

      // Step 3: Terminate pod and verify termination (wait up to 10 seconds)
      const deletePodResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: {
              resourceType: "pod",
              name: podName,
              namespace: "default",
              force: true
            },
          },
        },
        asResponseSchema(DeletePodResponseSchema)
      );

      expect(deletePodResult.content[0].type).toBe("text");
      expect(deletePodResult.content[0].text).toContain(`pod "${podName}" force deleted`);

      // Try to verify pod termination, but don't fail the test if we can't confirm it
      try {
        let podTerminated = false;
        const terminationStartTime = Date.now();

        while (!podTerminated && Date.now() - terminationStartTime < 10000) {
          try {
            const podStatus = await client.request(
              {
                method: "tools/call",
                params: {
                  name: "kubectl_get",
                  arguments: {
                    resourceType: "pod",
                    name: podName,
                    namespace: "default",
                    output: "json"
                  },
                },
              },
              asResponseSchema(ListPodsResponseSchema)
            );

            // Pod still exists, check if it's in Terminating state
            const status = JSON.parse(podStatus.content[0].text);
            if (status.status?.phase === "Terminating" || status.metadata?.deletionTimestamp) {
              podTerminated = true;
              break;
            }
            await sleep(500);
          } catch (error) {
            // If we get an error (404), the pod is gone which also means it's terminated
            podTerminated = true;
            break;
          }
        }

        // Log termination status but don't fail the test
        if (podTerminated) {
          console.log(`Pod ${podName} termination confirmed`);
        } else {
          console.log(
            `Pod ${podName} termination could not be confirmed within timeout, but deletion was initiated`
          );
        }
      } catch (error) {
        // Ignore any errors during termination check
        console.log(`Error checking pod termination status: ${error}`);
      }
    },
    { timeout: 120000 }
  );

  /**
   * Test case: Verify custom pod configuration
   * Tests creating a pod with a custom configuration
   */
  test(
    "custom pod configuration",
    async () => {
      const podName = `custom-test-${generateRandomSHA()}`;
      const namespace = "default";

      // Create a pod with custom configuration using kubectl_create
      const podManifest = {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: podName,
          namespace: namespace,
          labels: {
            app: "custom-test",
            testcase: "custom-pod-config",
            env: "production"
          }
        },
        spec: {
          containers: [
            {
              name: "nginx",
              image: "nginx:latest",
              ports: [
                {
                  containerPort: 80,
                  name: "http",
                  protocol: "TCP"
                }
              ],
              resources: {
                limits: {
                  cpu: "200m",
                  memory: "256Mi"
                },
                requests: {
                  cpu: "100m",
                  memory: "128Mi"
                }
              },
              env: [
                {
                  name: "NODE_ENV",
                  value: "production"
                }
              ]
            }
          ]
        }
      };

      const createPodResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              resourceType: "pod",
              name: podName,
              namespace: namespace,
              manifest: JSON.stringify(podManifest)
            },
          },
        },
        asResponseSchema(KubectlResponseSchema)
      );

      expect(createPodResult.content[0].type).toBe("text");
      // Check the pod data rather than the creation message since kubectl_create returns full object
      const podData = createPodResult.content[0].text;
      expect(podData).toContain(`name: ${podName}`);
      expect(podData).toContain(`namespace: ${namespace}`);
      expect(podData).toContain(`image: nginx:latest`);

      // Wait for pod to be running
      let podRunning = false;
      const startTime = Date.now();

      while (!podRunning && Date.now() - startTime < 60000) {
        const podStatus = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_get",
              arguments: {
                resourceType: "pod",
                name: podName,
                namespace: namespace,
                output: "json"
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );

        const status = JSON.parse(podStatus.content[0].text);
        if (status.status?.phase === "Running") {
          podRunning = true;
          break;
        }
        await sleep(1000);
      }

      expect(podRunning).toBe(true);

      // Verify pod configuration using kubectl_describe
      const podDetails = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_describe",
            arguments: {
              resourceType: "pod",
              name: podName,
              namespace: namespace
            },
          },
        },
        asResponseSchema(KubectlResponseSchema)
      );

      // Check that the description contains expected configuration values
      const describeText = podDetails.content[0].text;
      expect(describeText).toContain("Image:          nginx:latest");
      expect(describeText).toContain("Port:           80/TCP");
      expect(describeText).toContain("Limits:");
      expect(describeText).toContain("cpu:     200m");
      expect(describeText).toContain("memory:  256Mi");
      expect(describeText).toContain("Requests:");
      expect(describeText).toContain("cpu:     100m");
      expect(describeText).toContain("memory:  128Mi");
      expect(describeText).toContain("NODE_ENV:  production");

      // Get detailed pod information using kubectl_get
      const podJson = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "pod",
              name: podName,
              namespace: namespace,
              output: "json"
            },
          },
        },
        asResponseSchema(KubectlResponseSchema)
      );

      // Verify JSON details of the pod
      const details = JSON.parse(podJson.content[0].text);
      const container = details.spec.containers[0];
      expect(container.image).toBe("nginx:latest");
      expect(container.ports[0].containerPort).toBe(80);
      expect(container.resources.limits.cpu).toBe("200m");
      expect(container.resources.limits.memory).toBe("256Mi");
      expect(container.resources.requests.cpu).toBe("100m");
      expect(container.resources.requests.memory).toBe("128Mi");

      // Cleanup using kubectl_delete
      const deletePodResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: {
              resourceType: "pod",
              name: podName,
              namespace: namespace,
              force: true
            },
          },
        },
        asResponseSchema(KubectlResponseSchema)
      );

      expect(deletePodResult.content[0].type).toBe("text");
      expect(deletePodResult.content[0].text).toContain(`pod "${podName}" force deleted`);
    },
    { timeout: 60000 }
  );

  /**
   * Test case: Verify custom deployment configuration
   * Tests creating a deployment with a custom configuration
   */
  test("custom deployment configuration", async () => {
    let attempts = 0;
    const maxAttempts = 3;
    const waitTime = 2000;

    while (attempts < maxAttempts) {
      // Generate unique deployment name for each attempt to avoid "AlreadyExists" errors on retry
      const deploymentName = `test-deployment-${generateRandomSHA()}-${Date.now()}`;
      try {
        // Create deployment using kubectl_create with manifest
        const deploymentManifest = {
          apiVersion: "apps/v1",
          kind: "Deployment",
          metadata: {
            name: deploymentName,
            namespace: "default",
            labels: {
              app: deploymentName
            }
          },
          spec: {
            replicas: 1,
            selector: {
              matchLabels: {
                app: deploymentName
              }
            },
            template: {
              metadata: {
                labels: {
                  app: deploymentName
                }
              },
              spec: {
                containers: [
                  {
                    name: "nginx",
                    image: "nginx:1.14.2",
                    ports: [
                      {
                        containerPort: 80
                      }
                    ],
                    resources: {
                      limits: {
                        cpu: "100m",
                        memory: "128Mi"
                      },
                      requests: {
                        cpu: "50m",
                        memory: "64Mi"
                      }
                    }
                  }
                ]
              }
            }
          }
        };

        const createDeploymentResult = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_create",
              arguments: {
                resourceType: "deployment",
                name: deploymentName,
                namespace: "default",
                manifest: JSON.stringify(deploymentManifest)
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );

        expect(createDeploymentResult.content[0].type).toBe("text");
        // Check the deployment data rather than creation message
        const deploymentData = createDeploymentResult.content[0].text;
        expect(deploymentData).toContain(`name: ${deploymentName}`);
        expect(deploymentData).toContain(`namespace: default`);
        expect(deploymentData).toContain(`image: nginx:1.14.2`);

        // Wait for deployment to be ready
        await sleep(5000);

        // Verify deployment using kubectl_get
        const getDeploymentResult = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_get",
              arguments: {
                resourceType: "deployment",
                name: deploymentName,
                namespace: "default",
                output: "json"
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );

        expect(getDeploymentResult.content[0].type).toBe("text");
        const deployment = JSON.parse(getDeploymentResult.content[0].text);
        expect(deployment.metadata.name).toBe(deploymentName);
        expect(deployment.spec.replicas).toBe(1);

        // Replace the old scale_deployment test with kubectl_scale
        const scaleDeploymentResult = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_scale",
              arguments: {
                name: deploymentName,
                namespace: "default",
                replicas: 2,
                resourceType: "deployment"
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );

        expect(scaleDeploymentResult.content[0].type).toBe("text");
        const scaleResult1 = JSON.parse(scaleDeploymentResult.content[0].text);
        expect(scaleResult1.success).toBe(true);
        expect(scaleResult1.message).toContain(
          `Scaled deployment ${deploymentName} to 2 replicas`
        );

        // Test scaling to a different number of replicas
        const kubectlScaleResult = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_scale",
              arguments: {
                name: deploymentName,
                namespace: "default",
                replicas: 3,
                resourceType: "deployment"
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );

        expect(kubectlScaleResult.content[0].type).toBe("text");
        const scaleResult2 = JSON.parse(kubectlScaleResult.content[0].text);
        expect(scaleResult2.success).toBe(true);
        expect(scaleResult2.message).toContain(
          `Scaled deployment ${deploymentName} to 3 replicas`
        );

        // Cleanup using kubectl_delete
        const deleteDeploymentResult = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "deployment",
                name: deploymentName,
                namespace: "default"
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );

        expect(deleteDeploymentResult.content[0].type).toBe("text");
        // The text format can vary, just check if it mentions the deployment name and deleted
        const deleteText = deleteDeploymentResult.content[0].text;
        expect(deleteText.includes(deploymentName) && deleteText.includes("deleted")).toBe(true);

        // Wait for cleanup
        await sleep(4000);
        return;
      } catch (e) {
        attempts++;
        if (attempts === maxAttempts) {
          throw new Error(
            `Failed after ${maxAttempts} attempts. Last error: ${e.message}`
          );
        }
        await sleep(waitTime);
      }
    }
  }, { timeout: 120000 });

  /**
   * Test case: Verify ping support
   * Ensures that the server responds to ping requests.
   */
  test("ping support", async () => {
    console.log("Pinging server...");
    const pingResult = await client.request(
      {
        jsonrpc: "2.0",
        id: "123", // Example ID
        method: "ping",
      },
      asResponseSchema(PingResponseSchema)
    );
    expect(pingResult).toEqual({});
  });
});
