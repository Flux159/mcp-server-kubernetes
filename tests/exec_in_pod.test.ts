import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreatePodResponseSchema, DeletePodResponseSchema, ExecInPodResponseSchema, ListPodsResponseSchema } from "../src/models/response-schemas.js";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("exec_in_pod tool", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let podName: string;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "bun",
      args: ["src/index.ts"],
      stderr: "pipe",
    });
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    await sleep(1000);
    // Create a test pod
    podName = `exec-in-pod-test-${Math.random().toString(36).substring(2, 8)}`;
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "create_pod",
          arguments: {
            name: podName,
            namespace: "default",
            template: "busybox",
            command: ["/bin/sh", "-c", "sleep 60"],
          },
        },
      },
      CreatePodResponseSchema
    );
    // Wait for pod to be running
    let running = false;
    const start = Date.now();
    while (!running && Date.now() - start < 30000) {
      const res = await client.request(
        {
          method: "tools/call",
          params: {
            name: "describe_pod",
            arguments: { name: podName, namespace: "default" },
          },
        },
        ListPodsResponseSchema
      );
      const status = JSON.parse(res.content[0].text);
      if (status.status?.phase === "Running") running = true;
      else await sleep(1000);
    }
    expect(running).toBe(true);
  });

  test("executes a simple command (array form)", async () => {
    // Print pod status before exec
    const podStatus = await client.request(
      {
        method: "tools/call",
        params: {
          name: "describe_pod",
          arguments: { name: podName, namespace: "default" },
        },
      },
      ListPodsResponseSchema
    );
    console.log("Pod status before exec (array form):", podStatus.content[0].text);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "exec_in_pod",
          arguments: {
            name: podName,
            namespace: "default",
            command: ["echo", "hello-world"],
            container: "main",
          },
        },
      },
      ExecInPodResponseSchema
    );
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("hello-world");
  });

  test("executes a command (string form)", async () => {
    // Print pod status before exec
    const podStatus = await client.request(
      {
        method: "tools/call",
        params: {
          name: "describe_pod",
          arguments: { name: podName, namespace: "default" },
        },
      },
      ListPodsResponseSchema
    );
    console.log("Pod status before exec (string form):", podStatus.content[0].text);

    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "exec_in_pod",
          arguments: {
            name: podName,
            namespace: "default",
            command: "echo string-form-test",
            container: "main",
          },
        },
      },
      ExecInPodResponseSchema
    );
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("string-form-test");
  });

  test("returns error for non-existent pod", async () => {
    let errorCaught = false;
    try {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "exec_in_pod",
            arguments: {
              name: "does-not-exist",
              namespace: "default",
              command: "echo should-fail",
            },
          },
        },
        ExecInPodResponseSchema
      );
    } catch (e: any) {
      errorCaught = true;
      expect(e.message).toMatch(/Failed to execute command in pod/);
    }
    expect(errorCaught).toBe(true);
  });

  test("returns error for failing command", async () => {
    let errorCaught = false;
    try {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "exec_in_pod",
            arguments: {
              name: podName,
              namespace: "default",
              command: ["sh", "-c", "exit 1"],
              container: "main",
            },
          },
        },
        ExecInPodResponseSchema
      );
    } catch (e: any) {
      errorCaught = true;
      expect(e.message).toMatch(/Failed to execute command in pod/);
    }
    expect(errorCaught).toBe(true);
  });

  // Cleanup
  afterAll(async () => {
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "delete_pod",
          arguments: {
            name: podName,
            namespace: "default",
            ignoreNotFound: true,
          },
        },
      },
      DeletePodResponseSchema
    );
    await transport.close();
  });
});
