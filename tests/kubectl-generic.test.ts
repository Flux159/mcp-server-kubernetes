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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to retry operations that might be flaky
async function retry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(
        `Attempt ${attempt}/${maxRetries} failed. Retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

describe("kubectl_generic command", () => {
  let transport: StdioClientTransport;
  let client: Client;
  const testNamespace = "generic-test-" + Math.random().toString(36).substring(2, 7);

  beforeEach(async () => {
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
    await sleep(1000);
  });

  afterEach(async () => {
    try {
      // Delete the test namespace if it exists
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "namespace",
                name: testNamespace,
                force: true
              },
            },
          },
          KubectlResponseSchema
        );
      } catch (e) {
        // Ignore error if namespace doesn't exist
      }

      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  test("kubectl_generic can create a namespace", async () => {
    const result = await retry(async () => {
      const response = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_generic",
            arguments: {
              command: "create",
              resourceType: "namespace",
              name: testNamespace
            },
          },
        },
        z.any()
      ) as KubectlResponse;
      return response;
    });

    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain(`created`);
    
    // Verify the namespace was created
    const getResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "namespace",
            name: testNamespace
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(getResult.content[0].type).toBe("text");
    expect(getResult.content[0].text).toContain(testNamespace);
  });

  test("kubectl_generic can get resource with flags", async () => {
    // First, let's create a configmap to test
    const configMapName = "generic-test-cm";
    
    // Create a configmap using kubectl_generic
    await retry(async () => {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_generic",
            arguments: {
              command: "create",
              resourceType: "configmap",
              name: configMapName,
              namespace: "default",
              flags: {
                "from-literal": "key1=value1",
              }
            },
          },
        },
        z.any()
      );
    });
    
    // Now get the configmap using kubectl_generic with output flag
    const getResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "get",
            resourceType: "configmap",
            name: configMapName,
            namespace: "default",
            outputFormat: "json"
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(getResult.content[0].type).toBe("text");
    const configMap = JSON.parse(getResult.content[0].text);
    expect(configMap.metadata.name).toBe(configMapName);
    expect(configMap.data.key1).toBe("value1");
    
    // Clean up
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "configmap",
            name: configMapName,
            namespace: "default"
          },
        },
      },
      z.any()
    );
  });

  test("kubectl_generic can handle additional arguments", async () => {
    // Get all pods in kube-system namespace with custom arguments
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "get",
            resourceType: "pods",
            namespace: "kube-system",
            outputFormat: "wide",
            args: ["-l", "k8s-app=kube-dns"]  // Label selector as additional args
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(result.content[0].type).toBe("text");
    // The response should include pods with the label k8s-app=kube-dns
    // This is usually coredns in most K8s clusters
    expect(result.content[0].text).toMatch(/NAME\s+READY\s+STATUS/);
  });

  test("kubectl_generic can handle multiple operations in sequence", async () => {
    const testConfigMap = "sequence-test-cm";
    
    // 1. Create a configmap
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "create",
            resourceType: "configmap",
            name: testConfigMap,
            namespace: "default",
            flags: {
              "from-literal": "foo=bar"
            }
          },
        },
      },
      z.any()
    );
    
    // 2. Get the configmap
    const getResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "get",
            resourceType: "configmap",
            name: testConfigMap,
            namespace: "default",
            outputFormat: "json"
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    const configMap = JSON.parse(getResult.content[0].text);
    expect(configMap.data.foo).toBe("bar");
    
    // 3. Annotate the configmap
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "annotate",
            resourceType: "configmap",
            name: testConfigMap,
            namespace: "default",
            args: ["test-annotation=true"]
          },
        },
      },
      z.any()
    );
    
    // 4. Get the configmap again to check annotation
    const getUpdatedResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "get",
            resourceType: "configmap",
            name: testConfigMap,
            namespace: "default",
            outputFormat: "json"
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    const updatedConfigMap = JSON.parse(getUpdatedResult.content[0].text);
    expect(updatedConfigMap.metadata.annotations["test-annotation"]).toBe("true");
    
    // 5. Delete the configmap
    const deleteResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "delete",
            resourceType: "configmap",
            name: testConfigMap,
            namespace: "default"
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(deleteResult.content[0].text).toContain("deleted");
  });

  test("kubectl_generic supports allNamespaces parameter", async () => {
    // Get pods across all namespaces using the allNamespaces parameter,
    // also passing a namespace to verify allNamespaces takes precedence
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "get",
            resourceType: "pods",
            namespace: "default",
            allNamespaces: true
          },
        },
      },
      z.any()
    ) as KubectlResponse;

    expect(result.content[0].type).toBe("text");
    // With --all-namespaces, kubectl adds a NAMESPACE column
    expect(result.content[0].text).toMatch(/NAMESPACE\s+NAME/);
    // kube-system pods should be included, proving it's not scoped to default
    expect(result.content[0].text).toContain("kube-system");
  });

  test("kubectl_generic handles errors gracefully", async () => {
    const nonExistentResource = "non-existent-resource-" + Date.now();
    
    try {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_generic",
            arguments: {
              command: "get",
              resourceType: "pod",
              name: nonExistentResource,
              namespace: "default"
            },
          },
        },
        z.any()
      );
      
      // If we get here, the test has failed
      expect(true).toBe(false); // This should not execute
    } catch (error: any) {
      // Expect an error response
      expect(error.message).toContain("Failed to execute kubectl command");
    }
  });
}); 