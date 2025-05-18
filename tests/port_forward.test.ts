import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  PortForwardResponseSchema,
} from "../src/models/response-schemas.js";
import { KubectlResponseSchema } from "../src/models/kubectl-models.js";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateRandomSHA(): string {
  return Math.random().toString(36).substring(2, 15);
}

describe("kubectl operations", () => {
  let transport: StdioClientTransport;
  let client: Client;
  const testPodName = `test-nginx-${generateRandomSHA()}`;
  const testNamespace = "default";
  const testPort = 8080;

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
      await sleep(1000);
    } catch (e) {
      console.error("Error in beforeEach:", e);
      throw e;
    }
  });

  afterEach(async () => {
    try {
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  test("kubectl pod lifecycle", async () => {
    // Create a test nginx pod using kubectl_create
    const podManifest = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: testPodName,
        namespace: testNamespace,
        labels: {
          app: "nginx",
          test: "kubectl-test"
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
                protocol: "TCP"
              }
            ]
          }
        ]
      }
    };

    console.log(`Creating pod ${testPodName}...`);
    const createPodResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "pod",
            name: testPodName,
            namespace: testNamespace,
            manifest: JSON.stringify(podManifest)
          },
        },
      },
      KubectlResponseSchema
    );

    expect(createPodResult.content[0].type).toBe("text");
    
    // Verify the pod was created by checking for its name in the response
    const podData = createPodResult.content[0].text;
    expect(podData).toContain(`name: ${testPodName}`);
    
    // Add a delay to ensure the pod is created
    await sleep(3000);
    
    // List pods to verify our pod is included
    console.log(`Verifying pod ${testPodName} exists...`);
    const listPodsResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_list",
          arguments: {
            resourceType: "pods",
            namespace: testNamespace,
            output: "json"
          },
        },
      },
      KubectlResponseSchema
    );
    
    const podsList = JSON.parse(listPodsResult.content[0].text);
    console.log(`Found ${podsList.items?.length || 0} pods in the namespace`);
    
    // Defensively check for pod existence 
    const ourPod = podsList.items?.find((pod: any) => 
      (pod && pod.name === testPodName) || 
      (pod && pod.metadata && pod.metadata.name === testPodName)
    );
    
    // Verify our pod exists in the list
    if (!ourPod) {
      console.log("Pod not found in pod list, test will fail.");
      console.log(`Pod names in namespace: ${podsList.items?.map((p: any) => p?.name || p?.metadata?.name).join(', ')}`);
    } else {
      console.log(`Pod ${testPodName} found with status: ${ourPod.status || ourPod.status?.phase || 'unknown'}`);
    }
    
    expect(ourPod).toBeDefined();
    
    // Get pod details with kubectl_get
    console.log(`Getting pod ${testPodName} details...`);
    const getPodResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "pod",
            name: testPodName,
            namespace: testNamespace,
            output: "json"
          },
        },
      },
      KubectlResponseSchema
    );
    
    expect(getPodResult.content[0].type).toBe("text");
    const podDetails = JSON.parse(getPodResult.content[0].text);
    
    // Verify pod details
    expect(podDetails.metadata?.name || podDetails.name).toBe(testPodName);
    
    // Describe the pod with kubectl_describe
    console.log(`Describing pod ${testPodName}...`);
    const describePodResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_describe",
          arguments: {
            resourceType: "pod",
            name: testPodName,
            namespace: testNamespace
          },
        },
      },
      KubectlResponseSchema
    );
    
    expect(describePodResult.content[0].type).toBe("text");
    expect(describePodResult.content[0].text).toContain(testPodName);
    expect(describePodResult.content[0].text).toContain("nginx:latest");
    
    // Cleanup - delete the pod
    console.log(`Deleting pod ${testPodName}...`);
    const deletePodResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "pod",
            name: testPodName,
            namespace: testNamespace,
            force: true
          },
        },
      },
      KubectlResponseSchema
    );
    
    expect(deletePodResult.content[0].type).toBe("text");
    expect(deletePodResult.content[0].text).toContain(`pod "${testPodName}" force deleted`);
    
    console.log("Test completed successfully.");
  }, 60000); // 60 second timeout
});
