import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

// Define the response type for easier use in tests
type KubectlResponse = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

/**
 * Utility function to create a promise that resolves after specified milliseconds
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a random identifier for resource naming
 */
function generateRandomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Test suite for CronJob related operations using kubectl commands
 * Tests CronJob creation, listing, describing, and associated Job operations
 */
describe("kubernetes cronjob operations with kubectl commands", () => {
  let transport: StdioClientTransport;
  let client: Client;
  let testNamespace: string;
  const NAMESPACE_PREFIX = "test-cronjob-ns";

  /**
   * Set up before each test:
   * - Creates a new StdioClientTransport instance
   * - Initializes and connects the MCP client
   * - Creates a test namespace for isolation
   */
  beforeEach(async () => {
    try {
      // Create transport and client
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
      // Wait longer for connection to be established
      await sleep(5000);

      // Create a unique test namespace for test isolation
      testNamespace = `${NAMESPACE_PREFIX}-${generateRandomId()}`;
      console.log(`Creating test namespace: ${testNamespace}`);

      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              resourceType: "namespace",
              name: testNamespace,
            },
          },
        },
        // @ts-ignore - Ignoring type error for now
        z.any()
      );

      // Wait longer for namespace to be fully created
      await sleep(5000);
    } catch (e) {
      console.error("Error in beforeEach:", e);
      throw e;
    }
  });

  /**
   * Clean up after each test:
   * - Delete test namespace and resources
   * - Close transport connection
   */
  afterEach(async () => {
    try {
      // Clean up namespace using kubectl_delete
      console.log(`Cleaning up test namespace: ${testNamespace}`);
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: {
              resourceType: "namespace",
              name: testNamespace,
            },
          },
        },
        // @ts-ignore - Ignoring type error for now
        z.any()
      );

      // Close client connection
      await transport.close();
      await sleep(5000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  /**
   * Test case: Verify CronJob listing functionality
   */
  test("list cronjobs in namespace", async () => {
    // List CronJobs using kubectl_list
    const listResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_list",
          arguments: {
            resourceType: "cronjobs",
            namespace: testNamespace,
            output: "json"
          },
        },
      },
      // @ts-ignore - Ignoring type error for now
      z.any()
    ) as KubectlResponse;

    expect(listResult.content[0].type).toBe("text");
    const cronJobs = JSON.parse(listResult.content[0].text);
    expect(cronJobs).toBeDefined();
    
    // Check the structure of the response
    if (cronJobs.items) {
      expect(Array.isArray(cronJobs.items)).toBe(true);
    } else if (Array.isArray(cronJobs)) {
      // Direct array response
      expect(Array.isArray(cronJobs)).toBe(true);
    } else {
      // Unexpected format, log for debugging
      console.log("Unexpected CronJobs response format:", JSON.stringify(cronJobs).substring(0, 300));
    }
  }, 60000); // 60 second timeout

  /**
   * Test case: Comprehensive CronJob lifecycle
   * Tests creating, describing, and managing a CronJob
   */
  test(
    "cronjob lifecycle management with kubectl commands",
    async () => {
      const cronJobName = `test-cronjob-${generateRandomId()}`;

      // Step 1: Create a new CronJob
      console.log(`Creating CronJob: ${cronJobName}`);
      
      // Create CronJob manifest
      const cronJobManifest = `
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${cronJobName}
  namespace: ${testNamespace}
  labels:
    mcp-managed: "true"
    app: ${cronJobName}
spec:
  schedule: "*/5 * * * *"
  suspend: true
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: ${cronJobName}
            image: busybox
            command: ["/bin/sh", "-c", "echo Hello from CronJob $(date)"]
          restartPolicy: OnFailure
`;

      const createResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              manifest: cronJobManifest,
              namespace: testNamespace
            },
          },
        },
        // @ts-ignore - Ignoring type error for now
        z.any()
      ) as KubectlResponse;

      // Verify creation response
      expect(createResult.content[0].type).toBe("text");
      expect(createResult.content[0].text).toContain("CronJob");
      expect(createResult.content[0].text).toContain(cronJobName);

      // Wait for CronJob to be fully created
      await sleep(5000);

      // Step 2: Verify CronJob appears in list
      const listResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "cronjobs",
              namespace: testNamespace,
              output: "json"
            },
          },
        },
        // @ts-ignore - Ignoring type error for now
        z.any()
      ) as KubectlResponse;

      //print the response
      console.log("List CronJobs response:", listResult.content[0].text);
      expect(listResult.content[0].type).toBe("text");
      const cronJobs = JSON.parse(listResult.content[0].text);
      expect(cronJobs).toBeDefined();
      
      // Find our CronJob in the list - handle different response formats
      let createdCronJob;
      
      if (cronJobs.items && Array.isArray(cronJobs.items)) {
        // Standard K8s API response
        createdCronJob = cronJobs.items.find((cj: any) => {
          if (cj.metadata && cj.metadata.name) {
            return cj.metadata.name === cronJobName;
          } else if (cj.name) {
            return cj.name === cronJobName;
          }
          return false;
        });
      } else if (Array.isArray(cronJobs)) {
        // Direct array response
        createdCronJob = cronJobs.find((cj: any) => {
          if (typeof cj === 'string') {
            return cj === cronJobName;
          } else if (cj.metadata && cj.metadata.name) {
            return cj.metadata.name === cronJobName;
          } else if (cj.name) {
            return cj.name === cronJobName;
          }
          return false;
        });
      }
      
      expect(createdCronJob).toBeDefined();
      
      // Based on the actual response, we can only verify that the CronJob was created
      // The simplified API response doesn't include schedule or suspend values
      // Let's use kubectl_describe to get more detailed information
      
      // Step 3: Describe the CronJob
      const describeResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_describe",
            arguments: {
              resourceType: "cronjob",
              name: cronJobName,
              namespace: testNamespace,
            },
          },
        },
        // @ts-ignore - Ignoring type error for now
        z.any()
      ) as KubectlResponse;

      expect(describeResult.content[0].type).toBe("text");
      const describeOutput = describeResult.content[0].text;
      console.log("Describe CronJob output excerpt:", describeOutput.substring(0, 300));
      
      // Verify the schedule and suspended state from the describe output
      expect(describeOutput).toContain(cronJobName);
      expect(describeOutput).toContain("*/5 * * * *");  // Schedule should appear in the describe output
      expect(describeOutput).toContain("Suspend:"); // Check that suspend property exists
      expect(describeOutput).toMatch(/Suspend:.*True/i); // Check for suspend status (case-insensitive)
      expect(describeOutput).toContain("busybox");

      // Step 4: List Jobs (should be empty since CronJob is suspended)
      const listJobsResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_list",
            arguments: {
              resourceType: "jobs",
              namespace: testNamespace,
              labelSelector: `app=${cronJobName}`,
              output: "json"
            },
          },
        },
        // @ts-ignore - Ignoring type error for now
        z.any()
      ) as KubectlResponse;

      expect(listJobsResult.content[0].type).toBe("text");
      const jobs = JSON.parse(listJobsResult.content[0].text);
      expect(jobs.items).toBeDefined();
      expect(Array.isArray(jobs.items)).toBe(true);
      // Should be empty since we suspended the CronJob
      expect(jobs.items.length).toBe(0);

      // Step 5: Delete the CronJob
      const deleteCronJobResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: {
              resourceType: "cronjob",
              name: cronJobName,
              namespace: testNamespace,
            },
          },
        },
        // @ts-ignore - Ignoring type error for now
        z.any()
      ) as KubectlResponse;

      expect(deleteCronJobResult.content[0].type).toBe("text");
      expect(deleteCronJobResult.content[0].text).toContain(`"${cronJobName}" deleted`);
      
      // We should rely on the cleanup in afterEach to remove all resources
    },
    { timeout: 120000 } // 120 second timeout for increased reliability
  );
});
