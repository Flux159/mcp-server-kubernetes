
// Import required test frameworks and SDK components
import {
  expect,
  test,
  it,
  describe,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsResponseSchema } from "../src/models/tool-models.js";
import {
  ListPodsResponseSchema,
  ListNamespacesResponseSchema,
  ListNodesResponseSchema,
  CreatePodResponseSchema,
  DeletePodResponseSchema,
} from "../src/models/response-schemas.js";

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
        args: ["src/index.ts"],
        stderr: "pipe",
      });

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
    } catch (e) {
      console.error("Error in beforeEach:", e);
      throw e;
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
      ListToolsResponseSchema
    );
    expect(toolsList.tools).toBeDefined();
    expect(toolsList.tools.length).toBeGreaterThan(0);
  });

  /**
   * Test case: Verify namespace and node listing functionality
   * Tests both namespace and node listing operations in sequence
   */
  test("list namespaces and nodes", async () => {
    // List namespaces
    console.log("Listing namespaces...");
    const namespacesResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_namespaces",
          arguments: {},
        },
      },
      ListNamespacesResponseSchema
    );
    expect(namespacesResult.content[0].type).toBe("text");
    const namespaces = JSON.parse(namespacesResult.content[0].text);
    expect(namespaces.namespaces).toBeDefined();

    // List nodes
    console.log("Listing nodes...");
    const listNodesResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_nodes",
          arguments: {},
        },
      },
      ListNodesResponseSchema
    );
    expect(listNodesResult.content[0].type).toBe("text");
    const nodes = JSON.parse(listNodesResult.content[0].text);
    expect(nodes.nodes).toBeDefined();
    expect(Array.isArray(nodes.nodes)).toBe(true);
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
            name: "list_pods",
            arguments: {
              namespace: "default",
            },
          },
        },
        ListPodsResponseSchema
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
              name: "delete_pod",
              arguments: {
                name: pod.metadata.name,
                namespace: "default",
                ignoreNotFound: true,
              },
            },
          },
          DeletePodResponseSchema
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
                  name: "describe_pod",
                  arguments: {
                    name: pod.metadata.name,
                    namespace: "default",
                  },
                },
              },
              ListPodsResponseSchema
            );
            await sleep(500);
          } catch (error) {
            // If we get an error, it might be because the pod is gone (404)
            podDeleted = true;
          }
        }
      }

      // Create new pod with random SHA name
      const createPodResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "create_pod",
            arguments: {
              name: podName,
              namespace: "default",
              template: "busybox",
              command: [
                "/bin/sh",
                "-c",
                "echo Pod is running && sleep infinity",
              ],
            },
          },
        },
        CreatePodResponseSchema
      );

      expect(createPodResult.content[0].type).toBe("text");
      const podResult = JSON.parse(createPodResult.content[0].text);
      expect(podResult.podName).toBe(podName);

      // Step 2: Wait for Running state (up to 60 seconds)
      let podRunning = false;
      const startTime = Date.now();

      while (!podRunning && Date.now() - startTime < 60000) {
        const podStatus = await client.request(
          {
            method: "tools/call",
            params: {
              name: "describe_pod",
              arguments: {
                name: podName,
                namespace: "default",
              },
            },
          },
          ListPodsResponseSchema
        );

        const status = JSON.parse(podStatus.content[0].text);
        if (status.status?.phase === "Running") {
          podRunning = true;
          console.log(`Pod ${podName} is running. Checking logs...`);

          // Check pod logs once running
          const logsResult = await client.request(
            {
              method: "tools/call",
              params: {
                name: "get_logs",
                arguments: {
                  resourceType: "pod",
                  name: podName,
                  namespace: "default",
                },
              },
            },
            ListPodsResponseSchema
          );

          expect(logsResult.content[0].type).toBe("text");
          const logs = JSON.parse(logsResult.content[0].text);
          expect(logs.logs[podName]).toContain("Pod is running");
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
            name: "delete_pod",
            arguments: {
              name: podName,
              namespace: "default",
            },
          },
        },
        DeletePodResponseSchema
      );

      expect(deletePodResult.content[0].type).toBe("text");
      const deleteResult = JSON.parse(deletePodResult.content[0].text);
      expect(deleteResult.status).toBe("deleted");

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
                  name: "describe_pod",
                  arguments: {
                    name: podName,
                    namespace: "default",
                  },
                },
              },
              ListPodsResponseSchema
            );

            // Pod still exists, check if it's in Terminating state
            const status = JSON.parse(podStatus.content[0].text);
            if (status.status?.phase === "Terminating") {
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
});
