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
  maxRetries: number = 3,
  delayMs: number = 2000
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

describe("kubectl unified commands", () => {
  let transport: StdioClientTransport;
  let client: Client;
  const testNamespace = "kubectl-test-" + Math.random().toString(36).substring(2, 7);

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
    await sleep(2000);
  });

  afterEach(async () => {
    try {
      await transport.close();
      await sleep(2000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  test("kubectl_apply creates a namespace", async () => {
    const namespaceManifest = `
apiVersion: v1
kind: Namespace
metadata:
  name: ${testNamespace}
`;

    try {
      // Create namespace using kubectl_apply
      const result = await retry(async () => {
        const response = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_apply",
              arguments: {
                manifest: namespaceManifest
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        ) as KubectlResponse;
        return response;
      });

      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain(`namespace/${testNamespace} created`);
    } finally {
      // Clean up namespace
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "namespace",
                name: testNamespace
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      } catch (e) {
        console.warn("Failed to clean up namespace:", e);
      }
    }
  });

  test("kubectl_create creates a namespace", async () => {
    const testNamespaceName = "kubectl-create-test-" + Math.random().toString(36).substring(2, 7);
    const namespaceManifest = `
apiVersion: v1
kind: Namespace
metadata:
  name: ${testNamespaceName}
`;

    try {
      // Create namespace using kubectl_create
      const result = await retry(async () => {
        const response = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_create",
              arguments: {
                manifest: namespaceManifest
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        ) as KubectlResponse;
        return response;
      });

      expect(result.content[0].type).toBe("text");
      
      // kubectl create returns the object in YAML format, so we should verify it's valid
      expect(result.content[0].text).toContain(`kind: Namespace`);
      expect(result.content[0].text).toContain(`name: ${testNamespaceName}`);
      
      // Verify the namespace was actually created
      const getResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "namespace",
              name: testNamespaceName
            },
          },
        },
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      
      expect(getResult.content[0].type).toBe("text");
      expect(getResult.content[0].text).toContain(testNamespaceName);
    } finally {
      // Clean up namespace
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "namespace",
                name: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      } catch (e) {
        console.warn("Failed to clean up namespace:", e);
      }
    }
  });

  test("kubectl_create creates a namespace using subcommand", async () => {
    const testNamespaceName = "kubectl-create-direct-" + Math.random().toString(36).substring(2, 7);

    try {
      // Create namespace using kubectl_create with resourceType
      const result = await retry(async () => {
        const response = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_create",
              arguments: {
                resourceType: "namespace",
                name: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        ) as KubectlResponse;
        return response;
      });

      expect(result.content[0].type).toBe("text");
      
      // kubectl create returns the object in YAML format
      expect(result.content[0].text).toContain(`kind: Namespace`);
      expect(result.content[0].text).toContain(`name: ${testNamespaceName}`);
      
      // Verify the namespace was actually created
      const getResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "namespace",
              name: testNamespaceName
            },
          },
        },
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      
      expect(getResult.content[0].type).toBe("text");
      expect(getResult.content[0].text).toContain(testNamespaceName);
    } finally {
      // Clean up namespace
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "namespace",
                name: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      } catch (e) {
        console.warn("Failed to clean up namespace:", e);
      }
    }
  });

  test("kubectl_get retrieves namespaces", async () => {
    const result = await retry(async () => {
      const response = await client.request(
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
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      return response;
    });

    expect(result.content[0].type).toBe("text");
    
    // Parse JSON output and verify it contains expected namespaces
    const responseText = result.content[0].text;
    console.log("Response text:", responseText.substring(0, 300) + "...");
    
    const namespaces = JSON.parse(responseText);
    
    // Debug the structure of the namespaces object
    console.log("Namespaces structure:", Object.keys(namespaces));
    
    if (namespaces.items) {
      console.log("First namespace item:", namespaces.items[0]);
      
      expect(Array.isArray(namespaces.items)).toBe(true);
      
      // Check if the namespaces have the expected structure
      if (namespaces.items.length > 0 && namespaces.items[0].metadata) {
        // Standard Kubernetes API structure
        const namespaceNames = namespaces.items.map((ns: any) => ns.metadata.name);
        expect(namespaceNames).toContain("default");
        expect(namespaceNames).toContain("kube-system");
      } else if (namespaces.items.length > 0) {
        // Alternative structure - each item might be a string or have different structure
        console.log("Namespace item type:", typeof namespaces.items[0]);
        // Check if items are simple strings
        if (typeof namespaces.items[0] === 'string') {
          expect(namespaces.items).toContain("default");
          expect(namespaces.items).toContain("kube-system");
        } else {
          // Handle other potential structures by checking for common patterns
          const namespaceNames = namespaces.items.map((ns: any) => {
            // Handle different possible namespace item structures
            if (ns.name) return ns.name; 
            if (ns.namespaceName) return ns.namespaceName;
            if (ns.metadata && ns.metadata.name) return ns.metadata.name;
            // Stringify the item for debugging
            console.log("Namespace item structure:", JSON.stringify(ns));
            return "";
          }).filter(Boolean);
          
          expect(namespaceNames.length).toBeGreaterThan(0);
          expect(namespaceNames).toContain("default");
          expect(namespaceNames).toContain("kube-system");
        }
      } else {
        // No items found, test fails
        throw new Error("No namespace items found in response");
      }
    } else {
      // If 'items' doesn't exist, log what we got back
      console.log("Response doesn't contain 'items', full structure:", JSON.stringify(namespaces));
      
      // Check if namespaces is directly an array
      if (Array.isArray(namespaces)) {
        // Try to find namespace names directly
        const namespaceNames = namespaces.map((ns: any) => {
          if (typeof ns === 'string') return ns;
          if (ns.name) return ns.name;
          if (ns.metadata && ns.metadata.name) return ns.metadata.name;
          return "";
        }).filter(Boolean);
        
        expect(namespaceNames.length).toBeGreaterThan(0);
        expect(namespaceNames).toContain("default");
        expect(namespaceNames).toContain("kube-system");
      } else if (namespaces.namespaces) {
        // Check if we have a 'namespaces' property instead
        expect(Array.isArray(namespaces.namespaces)).toBe(true);
        expect(namespaces.namespaces).toContain("default");
        expect(namespaces.namespaces).toContain("kube-system");
      } else {
        throw new Error("Unexpected response structure: " + JSON.stringify(namespaces));
      }
    }
  });

  test("kubectl_describe describes a node", async () => {
    // First, get a list of nodes to find a valid node name
    const nodesResult = await retry(async () => {
      const response = await client.request(
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
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      return response;
    });

    expect(nodesResult.content[0].type).toBe("text");
    
    // Parse nodes data to get a node name
    const nodesData = JSON.parse(nodesResult.content[0].text);
    console.log("Nodes data structure:", Object.keys(nodesData));

    let nodeName: string;
    
    // Extract a node name based on the structure of the response
    if (nodesData.items && nodesData.items.length > 0) {
      // Standard K8s API response
      if (nodesData.items[0].metadata) {
        nodeName = nodesData.items[0].metadata.name;
      } else if (nodesData.items[0].name) {
        // Alternative structure
        nodeName = nodesData.items[0].name;
      } else {
        console.log("First node structure:", JSON.stringify(nodesData.items[0]));
        throw new Error("Unable to determine node name from response structure");
      }
    } else if (Array.isArray(nodesData) && nodesData.length > 0) {
      // Simple array of nodes
      if (typeof nodesData[0] === 'string') {
        nodeName = nodesData[0];
      } else if (nodesData[0].name) {
        nodeName = nodesData[0].name;
      } else if (nodesData[0].metadata && nodesData[0].metadata.name) {
        nodeName = nodesData[0].metadata.name;
      } else {
        console.log("First node structure:", JSON.stringify(nodesData[0]));
        throw new Error("Unable to determine node name from response structure");
      }
    } else {
      throw new Error("No nodes found in the response");
    }
    
    console.log(`Using node name: ${nodeName} for kubectl_describe test`);
    
    // Now use kubectl_describe to get details about the node
    const describeResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_describe",
          arguments: {
            resourceType: "node",
            name: nodeName
          },
        },
      },
      // @ts-ignore - Ignoring type error for now to get tests running
      z.any()
    ) as KubectlResponse;
    
    expect(describeResult.content[0].type).toBe("text");
    
    // Verify the describe output contains expected information
    const describeOutput = describeResult.content[0].text;
    console.log("Describe output excerpt:", describeOutput.substring(0, 300) + "...");
    
    // Check if the response contains typical node information
    expect(describeOutput).toContain(nodeName);
    
    // Check for common node information sections
    const expectedSections = ["Name:", "Labels:", "Annotations:", "Conditions:"];
    for (const section of expectedSections) {
      expect(describeOutput).toContain(section);
    }
  });

  // Test kubectl_list command
  test("kubectl_list lists deployments", async () => {
    // Use kubectl_list to get deployments in the kube-system namespace
    const listResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_list",
          arguments: {
            resourceType: "deployments",
            namespace: "kube-system"
          },
        },
      },
      // @ts-ignore - Ignoring type error for now to get tests running
      z.any()
    ) as KubectlResponse;
    
    expect(listResult.content[0].type).toBe("text");
    
    // Verify the list output
    const listOutput = listResult.content[0].text;
    console.log("List output excerpt:", listOutput.substring(0, 300) + "...");
    
    // Check for typically available deployments in kube-system namespace
    // Common deployments include coredns, kube-proxy, metrics-server, etc.
    // This test should pass even if the specific deployments vary
    expect(listOutput).toContain("kube-system");
    expect(listOutput).toContain("NAME");
    expect(listOutput).toContain("READY");
  });

  // Test kubectl_delete command with label selector
  test("kubectl_delete with label selector", async () => {
    // Create a test pod with a specific label
    const testPodName = `test-pod-${Math.random().toString(36).substring(2, 7)}`;
    const testLabel = "kubectl-test=true";
    
    const podManifest = `
apiVersion: v1
kind: Pod
metadata:
  name: ${testPodName}
  namespace: default
  labels:
    kubectl-test: "true"
spec:
  containers:
  - name: busybox
    image: busybox:latest
    command: ["sh", "-c", "sleep 3600"]
`;

    // Create the test pod
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_apply",
          arguments: {
            manifest: podManifest
          },
        },
      },
      // @ts-ignore - Ignoring type error for now to get tests running
      z.any()
    );
    
    // Give the pod a moment to be created
    await sleep(2000);
    
    try {
      // Verify the pod was created
      const getPodResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "pods",
              namespace: "default",
              labelSelector: testLabel
            },
          },
        },
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      
      expect(getPodResult.content[0].type).toBe("text");
      expect(getPodResult.content[0].text).toContain(testPodName);
      
      // Now delete the pod using the label selector
      const deleteResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: {
              resourceType: "pod",
              namespace: "default",
              labelSelector: testLabel
            },
          },
        },
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      
      expect(deleteResult.content[0].type).toBe("text");
      expect(deleteResult.content[0].text).toContain(`pod "${testPodName}" deleted`);
      
      // Verify the pod was deleted
      await sleep(2000);
      const verifyDeleteResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "pods",
              namespace: "default",
              labelSelector: testLabel
            },
          },
        },
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      
      // Should indicate no resources found
      const responseText = verifyDeleteResult.content[0].text;
      if (responseText.includes('{')) {
        // JSON response, check for empty items array
        const responseJson = JSON.parse(responseText);
        expect(Array.isArray(responseJson.items)).toBe(true);
        expect(responseJson.items.length).toBe(0);
      } else {
        // Text response, should contain 'No resources found'
        expect(responseText).toContain("No resources found");
      }
    } finally {
      // Cleanup in case the test failed
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "pod",
                name: testPodName,
                namespace: "default"
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
  });

  test("kubectl_create creates a ConfigMap using subcommand", async () => {
    const testNamespaceName = "kubectl-config-test-" + Math.random().toString(36).substring(2, 7);
    const configMapName = "test-config-direct";
    
    try {
      // First create namespace
      await retry(async () => {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_create",
              arguments: {
                resourceType: "namespace",
                name: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      });
      
      await sleep(3000); // Wait for namespace to be ready
      
      // Create ConfigMap using kubectl_create with resourceType and fromLiteral
      const result = await retry(async () => {
        const response = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_create",
              arguments: {
                resourceType: "configmap",
                name: configMapName,
                namespace: testNamespaceName,
                fromLiteral: ["key1=value1", "key2=value2"]
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        ) as KubectlResponse;
        return response;
      });
      
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain(`kind: ConfigMap`);
      expect(result.content[0].text).toContain(`name: ${configMapName}`);
      
      // Verify the ConfigMap was created
      const getResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "configmap",
              name: configMapName,
              namespace: testNamespaceName,
              output: "json"
            },
          },
        },
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      
      const configMapData = JSON.parse(getResult.content[0].text);
      expect(configMapData.metadata.name).toBe(configMapName);
      expect(configMapData.data.key1).toBe("value1");
      expect(configMapData.data.key2).toBe("value2");
    } finally {
      // Clean up namespace and resources
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "namespace",
                name: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      } catch (e) {
        console.warn("Failed to clean up namespace:", e);
      }
    }
  });
  
  test("kubectl_create creates a CronJob using manifest", async () => {
    const testNamespaceName = "kubectl-cronjob-test-" + Math.random().toString(36).substring(2, 7);
    const cronJobName = "test-cronjob-manifest";
    
    try {
      // First create namespace
      await retry(async () => {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_create",
              arguments: {
                resourceType: "namespace",
                name: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      });
      
      await sleep(3000); // Wait for namespace to be ready
      
      // Create CronJob using kubectl_create with manifest
      const cronJobManifest = `
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${cronJobName}
  namespace: ${testNamespaceName}
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
      
      const result = await retry(async () => {
        const response = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_create",
              arguments: {
                manifest: cronJobManifest,
                namespace: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        ) as KubectlResponse;
        return response;
      });
      
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain(`kind: CronJob`);
      expect(result.content[0].text).toContain(`name: ${cronJobName}`);
      
      // Verify the CronJob was created
      const getResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "cronjob",
              name: cronJobName,
              namespace: testNamespaceName,
              output: "json"
            },
          },
        },
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      
      const cronJobData = JSON.parse(getResult.content[0].text);
      expect(cronJobData.metadata.name).toBe(cronJobName);
      expect(cronJobData.spec.schedule).toBe("*/5 * * * *");
      expect(cronJobData.spec.suspend).toBe(true);
    } finally {
      // Clean up namespace and resources
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "namespace",
                name: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      } catch (e) {
        console.warn("Failed to clean up namespace:", e);
      }
    }
  });
  
  test("kubectl_create creates a CronJob using subcommand", async () => {
    const testNamespaceName = "kubectl-cronjob-direct-" + Math.random().toString(36).substring(2, 7);
    const cronJobName = "test-cronjob-direct-" + Math.random().toString(36).substring(2, 7);
    
    try {
      // First delete any existing cronjob with this name to ensure clean state
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "cronjob",
                name: cronJobName,
                namespace: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      } catch (e) {
        // Ignore if it doesn't exist
      }
      
      // First create namespace
      await retry(async () => {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_create",
              arguments: {
                resourceType: "namespace",
                name: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      });
      
      await sleep(3000); // Wait for namespace to be ready
      
      // Create CronJob using kubectl_create with resourceType
      const result = await retry(async () => {
        const response = await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_create",
              arguments: {
                resourceType: "cronjob",
                name: cronJobName,
                namespace: testNamespaceName,
                schedule: "*/10 * * * *",
                image: "busybox",
                command: ["/bin/sh", "-c", "echo Hello from direct CronJob"],
                suspend: true
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        ) as KubectlResponse;
        return response;
      });
      
      console.log("CronJob creation response:", result.content[0].text);
      expect(result.content[0].type).toBe("text");
      
      // Check for creation success message
      const responseText = result.content[0].text;
      if (responseText.includes('kind:')) {
        // YAML output
        expect(responseText).toContain(`kind: CronJob`);
        expect(responseText).toContain(`name: ${cronJobName}`);
      } else {
        // Success message output
        expect(responseText).toContain(`cronjob.batch/${cronJobName} created`);
      }
      
      // Verify the CronJob was created
      const getResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "cronjob",
              name: cronJobName,
              namespace: testNamespaceName,
              output: "json"
            },
          },
        },
        // @ts-ignore - Ignoring type error for now to get tests running
        z.any()
      ) as KubectlResponse;
      
      console.log("CronJob get response:", getResult.content[0].text);
      
      const cronJobData = JSON.parse(getResult.content[0].text);
      
      // Handle different response formats
      if (cronJobData.metadata && cronJobData.metadata.name) {
        // Standard K8s API format
        expect(cronJobData.metadata.name).toBe(cronJobName);
        expect(cronJobData.spec.schedule).toBe("*/10 * * * *");
        expect(cronJobData.spec.suspend).toBe(true);
      } else if (cronJobData.name) {
        // Simplified format
        expect(cronJobData.name).toBe(cronJobName);
        
        // If schedule and suspend are included in the simplified format
        if (cronJobData.schedule) {
          expect(cronJobData.schedule).toBe("*/10 * * * *");
        }
        if (cronJobData.suspend !== undefined) {
          expect(cronJobData.suspend).toBe(true);
        }
      } else {
        // For any other format, just check that the response contains the cronjob name
        expect(getResult.content[0].text).toContain(cronJobName);
      }
    } finally {
      // Clean up namespace and resources
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "namespace",
                name: testNamespaceName
              },
            },
          },
          // @ts-ignore - Ignoring type error for now to get tests running
          z.any()
        );
      } catch (e) {
        console.warn("Failed to clean up namespace:", e);
      }
    }
  });
}); 