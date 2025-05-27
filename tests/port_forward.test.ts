import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListPodsResponseSchema,
  CreatePodResponseSchema,
  DeletePodResponseSchema,
  PortForwardResponseSchema,
} from "../src/models/response-schemas.js";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateRandomSHA(): string {
  return Math.random().toString(36).substring(2, 15);
}

describe("port-forward operations", () => {
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

      // Create a test nginx pod
      const createPodResult = await client.request(
        {
          method: "tools/call",
          params: {
            name: "create_pod",
            arguments: {
              name: testPodName,
              namespace: testNamespace,
              template: "nginx",
            },
          },
        },
        CreatePodResponseSchema
      );

      expect(createPodResult.content[0].type).toBe("text");
      const podResult = JSON.parse(createPodResult.content[0].text);
      expect(podResult.podName).toBe(testPodName);

      // Wait for pod to be running
      let podRunning = false;
      const startTime = Date.now();

      while (!podRunning && Date.now() - startTime < 60000) {
        const podStatus = await client.request(
          {
            method: "tools/call",
            params: {
              name: "describe_pod",
              arguments: {
                name: testPodName,
                namespace: testNamespace,
              },
            },
          },
          ListPodsResponseSchema
        );

        const status = JSON.parse(podStatus.content[0].text);
        if (status.status?.phase === "Running") {
          podRunning = true;
          break;
        }
        await sleep(1000);
      }

      expect(podRunning).toBe(true);
    } catch (e) {
      console.error("Error in beforeEach:", e);
      throw e;
    }
  });

  afterEach(async () => {
    try {
      // Cleanup: Delete the test pod
      await client
        .request(
          {
            method: "tools/call",
            params: {
              name: "delete_pod",
              arguments: {
                name: testPodName,
                namespace: testNamespace,
                ignoreNotFound: true,
              },
            },
          },
          DeletePodResponseSchema
        )
        .catch(() => {}); // Ignore errors if pod doesn't exist

      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  test("port-forward to nginx pod", async () => {
    // Start port-forward
    const portForwardResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "port_forward",
          arguments: {
            resourceType: "pod",
            resourceName: testPodName,
            localPort: testPort,
            targetPort: 80, // nginx default port
          },
        },
      },
      PortForwardResponseSchema
    );

    expect(portForwardResult.content[0].success).toBe(true);
    expect(portForwardResult.content[0].message).toBe(
      "port-forwarding was successful"
    );

    // Wait a moment for the port-forward to establish
    await sleep(2000);

    // Test the connection using curl
    const curlResult = await new Promise((resolve, reject) => {
      const { exec } = require("child_process");
      exec(
        `curl -s http://localhost:${testPort}`,
        (error: any, stdout: string) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout);
          }
        }
      );
    });

    // Verify we got the nginx welcome page
    expect(curlResult).toContain("Welcome to nginx!");

    // Clean up the port-forward
    const portForward = await client.request(
      {
        method: "tools/call",
        params: {
          name: "stop_port_forward",
          arguments: {
            id: `pod-${testPodName}-${testPort}`,
          },
        },
      },
      PortForwardResponseSchema
    );

    expect(portForward.content[0].success).toBe(true);
  }, 30000); // 30 second timeout
});
