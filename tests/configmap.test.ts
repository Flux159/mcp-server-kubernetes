// Import necessary modules and dependencies
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

// Test suite for Kubernetes ConfigMap operations using kubectl commands
describe("test kubernetes configmap with kubectl commands", () => {
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
      await sleep(5000); // Wait longer for the client to connect

      testNamespace = `${NAMESPACE_PREFIX}-${generateRandomId()}`;
      console.log(`Creating test namespace: ${testNamespace}`);

      console.log("About to create namespace:", testNamespace);
      try {
        // Create a test namespace using kubectl_create
        const namespaceResponse = await client.request({
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              resourceType: "namespace",
              name: testNamespace
            },
          },
        }, 
        // @ts-ignore - Ignoring type error for now
        z.any()) as KubectlResponse;
        
        console.log("Namespace creation response:", JSON.stringify(namespaceResponse));
      } catch (error) {
        console.error("Error creating namespace:", error);
        throw error;
      }

      await sleep(5000); // Wait longer for the namespace to be created
    } catch (error: any) {
      console.error("Error in beforeEach:", error);
      throw error;
    }
  });

  // Cleanup after each test
  afterEach(async () => {
    try {
      console.log(`Cleaning up test namespace: ${testNamespace}`);
      
      // Delete the test namespace using kubectl_delete
      await client.request({
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "namespace",
            name: testNamespace
          },
        },
      }, 
      // @ts-ignore - Ignoring type error for now
      z.any());
      
      await transport.close(); // Close the transport
      await sleep(5000); // Wait longer for cleanup to complete
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  // Test case: Verify creation of a ConfigMap
  test("verify creation of configmap", async () => {
    const testData = {
      key1: "hello",
      key2: "world",
    };

    // Create ConfigMap using kubectl_create with resourceType and fromLiteral
    const fromLiteralArgs = Object.entries(testData).map(([key, value]) => `${key}=${value}`);
    
    const createResponse = await client.request({
      method: "tools/call",
      params: {
        name: "kubectl_create",
        arguments: {
          resourceType: "configmap",
          name: testName,
          namespace: testNamespace,
          fromLiteral: fromLiteralArgs
        },
      },
    }, 
    // @ts-ignore - Ignoring type error for now
    z.any()) as KubectlResponse;

    console.log("ConfigMap creation response:", JSON.stringify(createResponse));
    expect(createResponse.content[0].type).toBe("text");
    expect(createResponse.content[0].text).toContain(`kind: ConfigMap`);
    expect(createResponse.content[0].text).toContain(`name: ${testName}`);
    
    // Wait longer for the ConfigMap to be fully created
    await sleep(5000);
  }, 60000); // 60 second timeout

  // Test case: Verify retrieval of a ConfigMap
  test("verify get of configmap", async () => {
    const testData = {
      key1: "foo",
      key2: "bar",
    };

    // Create ConfigMap using kubectl_create with resourceType and fromLiteral
    const fromLiteralArgs = Object.entries(testData).map(([key, value]) => `${key}=${value}`);
    
    await client.request({
      method: "tools/call",
      params: {
        name: "kubectl_create",
        arguments: {
          resourceType: "configmap",
          name: testName,
          namespace: testNamespace,
          fromLiteral: fromLiteralArgs
        },
      },
    }, 
    // @ts-ignore - Ignoring type error for now
    z.any()) as KubectlResponse;
    
    await sleep(5000); // Wait longer for the ConfigMap to be created

    // Retrieve the ConfigMap using kubectl_get
    const getResponse = await client.request({
      method: "tools/call",
      params: {
        name: "kubectl_get",
        arguments: {
          resourceType: "configmap",
          name: testName,
          namespace: testNamespace,
          output: "json"
        },
      },
    }, 
    // @ts-ignore - Ignoring type error for now
    z.any()) as KubectlResponse;

    console.log("Get configmap response:", JSON.stringify(getResponse));
    
    // Validate the content
    expect(getResponse.content[0].type).toBe("text");
    
    // Parse the JSON response
    const configMapData = JSON.parse(getResponse.content[0].text);
    expect(configMapData.metadata.name).toBe(testName);
    expect(configMapData.metadata.namespace).toBe(testNamespace);
    expect(configMapData.data).toEqual(testData);
  }, 60000); // 60 second timeout

  // Test case: Verify update of a ConfigMap
  test("verify update of configmap", async () => {
    const initialData = {
      key1: "init",
      key2: "val",
    };

    // Create ConfigMap using kubectl_create with resourceType and fromLiteral
    const fromLiteralArgs = Object.entries(initialData).map(([key, value]) => `${key}=${value}`);
    
    await client.request({
      method: "tools/call",
      params: {
        name: "kubectl_create",
        arguments: {
          resourceType: "configmap",
          name: testName,
          namespace: testNamespace,
          fromLiteral: fromLiteralArgs
        },
      },
    }, 
    // @ts-ignore - Ignoring type error for now
    z.any()) as KubectlResponse;
    
    await sleep(5000); // Wait longer for the ConfigMap to be created

    // Now update the ConfigMap with new data
    const updatedData = {
      key1: "updated",
      key2: "val",
      key3: "new",
    };
    
    // Convert the updated data to YAML string for the manifest
    const updatedDataYaml = Object.entries(updatedData)
      .map(([key, value]) => `  ${key}: ${value}`)
      .join('\n');
    
    // Update ConfigMap using kubectl_apply again
    const updateManifest = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${testName}
  namespace: ${testNamespace}
data:
${updatedDataYaml}
`;
    
    const updateResponse = await client.request({
      method: "tools/call",
      params: {
        name: "kubectl_apply",
        arguments: {
          manifest: updateManifest,
          namespace: testNamespace
        },
      },
    }, 
    // @ts-ignore - Ignoring type error for now
    z.any()) as KubectlResponse;

    console.log("ConfigMap update response:", JSON.stringify(updateResponse));
    expect(updateResponse.content[0].type).toBe("text");
    expect(updateResponse.content[0].text).toContain(`configmap/${testName} configured`);

    // Wait longer for update to be applied
    await sleep(5000);
    
    // Verify the update using kubectl_get
    const getResponse = await client.request({
      method: "tools/call",
      params: {
        name: "kubectl_get",
        arguments: {
          resourceType: "configmap",
          name: testName,
          namespace: testNamespace,
          output: "json"
        },
      },
    }, 
    // @ts-ignore - Ignoring type error for now
    z.any()) as KubectlResponse;
    
    // Parse the JSON response
    const configMapData = JSON.parse(getResponse.content[0].text);
    expect(configMapData.data).toEqual(updatedData);
    expect(configMapData.data.key3).toBe("new");
  }, 120000); // 120 second timeout for update test

  // Test case: Verify deletion of a ConfigMap
  test("verify delete of configmap", async () => {
    const testData = {
      key1: "to-be-deleted",
    };

    // Create ConfigMap using kubectl_create with resourceType and fromLiteral
    const fromLiteralArgs = Object.entries(testData).map(([key, value]) => `${key}=${value}`);
    
    await client.request({
      method: "tools/call",
      params: {
        name: "kubectl_create",
        arguments: {
          resourceType: "configmap",
          name: testName,
          namespace: testNamespace,
          fromLiteral: fromLiteralArgs
        },
      },
    }, 
    // @ts-ignore - Ignoring type error for now
    z.any()) as KubectlResponse;
    
    await sleep(5000); // Wait longer for the ConfigMap to be created

    // Delete the ConfigMap using kubectl_delete
    const deleteResponse = await client.request({
      method: "tools/call",
      params: {
        name: "kubectl_delete",
        arguments: {
          resourceType: "configmap",
          name: testName,
          namespace: testNamespace
        },
      },
    }, 
    // @ts-ignore - Ignoring type error for now
    z.any()) as KubectlResponse;
    
    expect(deleteResponse.content[0].type).toBe("text");
    expect(deleteResponse.content[0].text).toContain(`configmap "${testName}" deleted`);

    // Verify the ConfigMap is deleted by trying to get it
    await sleep(5000); // Wait longer for deletion to complete
    
    const getResponse = await client.request({
      method: "tools/call",
      params: {
        name: "kubectl_get",
        arguments: {
          resourceType: "configmap",
          name: testName,
          namespace: testNamespace,
          output: "json"
        },
      },
    }, 
    // @ts-ignore - Ignoring type error for now
    z.any()) as KubectlResponse;
    
    // Should indicate the resource is not found
    expect(getResponse.content[0].type).toBe("text");
    expect(getResponse.content[0].text).toContain("not found");
  }, 60000); // 60 second timeout
});
