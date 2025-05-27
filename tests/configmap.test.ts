// Import necessary modules and dependencies
import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateNamespaceResponseSchema } from "../src/types";
import {
  CreateConfigMapResponseSchema,
  GetConfigMapResponseSchema,
  UpdateConfigMapResponseSchema,
  DeleteConfigMapResponseSchema
} from "../src/models/response-schemas.js";
import { KubernetesManager } from "../src/types";

// Utility function to introduce a delay
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Utility function to generate a random ID
function generateRandomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Utility function to generate a random SHA-like string
function generateRandomSHA(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Test suite for Kubernetes ConfigMap operations
describe("test kubernetes configmap", () => {
  let transport: StdioClientTransport;
  let client: Client;
  const NAMESPACE_PREFIX = "test-configmap"; // Prefix for test namespaces
  let testNamespace: string;
  const testName = `test-configmap-${generateRandomSHA()}`; // Unique name for the ConfigMap

  // Setup before each test
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
      await sleep(1000); // Wait for the client to connect

      testNamespace = `${NAMESPACE_PREFIX}-${generateRandomId()}`;
      console.log(`Creating test namespace: ${testNamespace}`);

      console.log("About to create namespace:", testNamespace);
      try {
        // Create a test namespace
        const namespaceResponse = await client.request({
          method: "tools/call",
          params: {
            name: "create_namespace",
            arguments: {
              name: testNamespace,
            },
          },
        }, CreateNamespaceResponseSchema);
        console.log("Namespace creation response:", JSON.stringify(namespaceResponse));
      } catch (error) {
        console.error("Error creating namespace:", error);
        throw error;
      }

      await sleep(2000); // Wait for the namespace to be created
    } catch (error: any) {
      console.error("Error in beforeEach:", error);
      throw error;
    }
  });

  // Cleanup after each test
  afterEach(async () => {
    try {
      console.log(`Cleaning up test namespace: ${testNamespace}`);
      const k8sManager = new KubernetesManager();
      await k8sManager.getCoreApi().deleteNamespace(testNamespace); // Delete the test namespace
      await transport.close(); // Close the transport
      await sleep(1000); // Wait for cleanup to complete
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  // Test case: Verify creation of a ConfigMap
  test("verify creation of configmap", async () => {
    const testdata = {
      key1: "hello",
      key2: "world",
    };

    // Create a ConfigMap
    const configmap_response = client.request({
      method: "tools/call",
      params: {
        name: "create_configmap",
        arguments: {
          name: testName,
          namespace: testNamespace,
          data: testdata,
        },
      },
    }, CreateConfigMapResponseSchema);

    await sleep(2000);
    const result = await configmap_response as any;
    console.log(result.content[0]);
    // Validate the response
    expect(result.content[0].success).toBe(true);
    expect(result.content[0].message).toContain(
      `Created ConfigMap ${testName} in namespace ${testNamespace}`
    );
  });

  // Test case: Verify retrieval of a ConfigMap
  test("verify get of configmap", async () => {
    const testdata = {
      key1: "foo",
      key2: "bar",
    };

    // Create a ConfigMap
    await client.request({
      method: "tools/call",
      params: {
        name: "create_configmap",
        arguments: {
          name: testName,
          namespace: testNamespace,
          data: testdata,
        },
      },
    }, CreateConfigMapResponseSchema);
    await sleep(2000); // Wait for the ConfigMap to be created

    // Retrieve the ConfigMap
    const get_response = await client.request({
      method: "tools/call",
      params: {
        name: "get_configmap",
        arguments: {
          name: testName,
          namespace: testNamespace,
        },
      },
    }, GetConfigMapResponseSchema);

    await sleep(1000);
    const result = await get_response as any;
    console.log("Get configmap response:", JSON.stringify(result));
    // Validate the retrieved data
    expect(result.content[0].success).toBe(true);
    expect( result.content[0].message).toContain(
      `Fetched ConfigMap ${testName} in namespace ${testNamespace}`
    
     );
    expect( result.content[0].data).toEqual(testdata);
  });

  // Test case: Verify update of a ConfigMap
  test("verify update of configmap", async () => {
    const testdata = {
      key1: "init",
      key2: "val",
    };

    // Create a ConfigMap
    await client.request({
      method: "tools/call",
      params: {
        name: "create_configmap",
        arguments: {
          name: testName,
          namespace: testNamespace,
          data: testdata,
        },
      },
    }, CreateConfigMapResponseSchema);
    await sleep(2000); // Wait for the ConfigMap to be created

    const updatedData = {
      key1: "updated",
      key2: "val",
      key3: "new",
    };

    // Update the ConfigMap
    const update_response = await client.request({
      method: "tools/call",
      params: {
        name: "update_configmap",
        arguments: {
          name: testName,
          namespace: testNamespace,
          data: updatedData,
        },
      },
    }, UpdateConfigMapResponseSchema);

    const result = await update_response as any;
    console.log("Get configmap response:", JSON.stringify(result));
    // Validate the update response
    expect(result.content[0].success).toBe(true);
    expect(result.content[0].message).toContain(
      `Updated ConfigMap ${testName} in namespace ${testNamespace}`
    );

    // Retrieve the updated ConfigMap
    const get_response = await client.request({
      method: "tools/call",
      params: {
        name: "get_configmap",
        arguments: {
          name: testName,
          namespace: testNamespace,
        },
      },
    }, GetConfigMapResponseSchema) as any;
    // Validate the updated data
    expect(get_response.content[0].success).toBe(true);
    expect(get_response.content[0].data).toEqual(updatedData);
  });

  // Test case: Verify deletion of a ConfigMap
  test("verify delete of configmap", async () => {
    const testdata = {
      key1: "to-be-deleted",
    };

    // Create a ConfigMap
    await client.request({
      method: "tools/call",
      params: {
        name: "create_configmap",
        arguments: {
          name: testName,
          namespace: testNamespace,
          data: testdata,
        },
      },
    }, CreateConfigMapResponseSchema);
    await sleep(2000); // Wait for the ConfigMap to be created

    // Delete the ConfigMap
    const delete_response = await client.request({
      method: "tools/call",
      params: {
        name: "delete_configmap",
        arguments: {
          name: testName,
          namespace: testNamespace,
        },
      },
    }, DeleteConfigMapResponseSchema);
    // Validate the delete response
    expect(delete_response.content[0].success).toBe(true);
    expect(delete_response.content[0].message).toContain(
      `Deleted ConfigMap ${testName} in namespace ${testNamespace}`
    );

    // Attempt to retrieve the deleted ConfigMap
    const get_response = await client.request({
      method: "tools/call",
      params: {
        name: "get_configmap",
        arguments: {
          name: testName,
          namespace: testNamespace,
        },
      },
    }, GetConfigMapResponseSchema);
    // Validate that the ConfigMap no longer exists
    expect(get_response.content[0].success).toBe(false);
  });
});
