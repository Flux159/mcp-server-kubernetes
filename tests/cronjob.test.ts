import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListCronJobsResponseSchema,
  CreateCronJobResponseSchema,
  DescribeCronJobResponseSchema,
  ListJobsResponseSchema,
  GetJobLogsResponseSchema,
  CreateNamespaceResponseSchema,
  DeleteCronJobResponseSchema,
} from "../src/models/response-schemas.js";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";

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
 * Test suite for CronJob related operations
 * Tests CronJob creation, listing, describing, and associated Job operations
 */
describe("kubernetes cronjob operations", () => {
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
      // Wait for connection to be established
      await sleep(1000);

      // Create a unique test namespace for test isolation
      testNamespace = `${NAMESPACE_PREFIX}-${generateRandomId()}`;
      console.log(`Creating test namespace: ${testNamespace}`);

      await client.request(
        {
          method: "tools/call",
          params: {
            name: "create_namespace",
            arguments: {
              name: testNamespace,
            },
          },
        },
        CreateNamespaceResponseSchema
      );

      // Wait for namespace to be fully created
      await sleep(2000);
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
      // Clean up namespace using direct API call
      console.log(`Cleaning up test namespace: ${testNamespace}`);
      const k8sManager = new KubernetesManager();
      await k8sManager.getCoreApi().deleteNamespace(testNamespace);

      // Close client connection
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  /**
   * Test case: Verify CronJob listing functionality
   */
  test("list cronjobs in namespace", async () => {
    // List CronJobs
    const listResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_cronjobs",
          arguments: {
            namespace: testNamespace,
          },
        },
      },
      ListCronJobsResponseSchema
    );

    expect(listResult.content[0].type).toBe("text");
    const cronJobs = JSON.parse(listResult.content[0].text);
    expect(cronJobs.cronjobs).toBeDefined();
    expect(Array.isArray(cronJobs.cronjobs)).toBe(true);
  });

  /**
   * Test case: Comprehensive CronJob lifecycle
   * Tests creating, describing, and managing a CronJob
   */
  test(
    "cronjob lifecycle management",
    async () => {
      const cronJobName = `test-cronjob-${generateRandomId()}`;

      // Step 1: Create a new CronJob
      console.log(`Creating CronJob: ${cronJobName}`);
      const createResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "create_cronjob",
            arguments: {
              name: cronJobName,
              namespace: testNamespace,
              schedule: "*/5 * * * *", // Run every 5 minutes
              image: "busybox",
              command: ["/bin/sh", "-c", "echo Hello from CronJob $(date)"],
              suspend: true, // Suspend it so it doesn't actually run during test
            },
          },
        },
        CreateCronJobResponseSchema
      );

      // Verify creation response
      expect(createResult.content[0].type).toBe("text");
      const createResponse = JSON.parse(createResult.content[0].text);
      expect(createResponse.cronJobName).toBe(cronJobName);
      expect(createResponse.schedule).toBe("*/5 * * * *");
      expect(createResponse.status).toBe("created");

      // Wait for CronJob to be fully created
      await sleep(3000);

      // Step 2: Verify CronJob appears in list
      const listResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_cronjobs",
            arguments: {
              namespace: testNamespace,
            },
          },
        },
        ListCronJobsResponseSchema
      );

      const cronJobs = JSON.parse(listResult.content[0].text);
      expect(cronJobs.cronjobs).toBeDefined();

      // Find our CronJob in the list
      const createdCronJob = cronJobs.cronjobs.find(
        (cj: any) => cj.name === cronJobName
      );
      expect(createdCronJob).toBeDefined();
      expect(createdCronJob.schedule).toBe("*/5 * * * *");
      expect(createdCronJob.suspend).toBe(true);

      // Step 3: Describe the CronJob
      const describeResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "describe_cronjob",
            arguments: {
              name: cronJobName,
              namespace: testNamespace,
            },
          },
        },
        DescribeCronJobResponseSchema
      );

      expect(describeResult.content[0].type).toBe("text");
      const cronJobDetails = JSON.parse(describeResult.content[0].text);
      expect(cronJobDetails.name).toBe(cronJobName);
      expect(cronJobDetails.namespace).toBe(testNamespace);
      expect(cronJobDetails.schedule).toBe("*/5 * * * *");
      expect(cronJobDetails.suspend).toBe(true);
      expect(cronJobDetails.jobTemplate.image).toBe("busybox");

      // Step 4: List Jobs (should be empty since CronJob is suspended)
      const listJobsResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_jobs",
            arguments: {
              namespace: testNamespace,
              cronJobName: cronJobName,
            },
          },
        },
        ListJobsResponseSchema
      );

      expect(listJobsResult.content[0].type).toBe("text");
      const jobs = JSON.parse(listJobsResult.content[0].text);
      expect(jobs.jobs).toBeDefined();
      expect(Array.isArray(jobs.jobs)).toBe(true);
      // Should be empty since we suspended the CronJob
      expect(jobs.jobs.length).toBe(0);

      const deletecronjobresult = await client.request(
        {
          method : "tools/call",
          params : {
            name : "delete_cronjob",
            arguments  : {
              name : cronJobName,
              namespace : testNamespace,
            },
          },
        },
        DeleteCronJobResponseSchema
      );

      expect(deletecronjobresult.content[0].success).toBe(true)
      expect(deletecronjobresult.content[0].message).toContain(`Deleted cronjob ${cronJobName} in namespace ${testNamespace}.`)

      
      // No need to test get_job_logs since we don't have any jobs in this controlled test

      // We should rely on the cleanup in afterEach to remove all resources
    },
    { timeout: 60000 } // 60 second timeout
  );
});
