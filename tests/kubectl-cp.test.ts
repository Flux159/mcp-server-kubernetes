import { test, expect, beforeEach, afterEach, describe } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { z } from "zod";

type KubectlResponse = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateRandomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

describe("test kubectl cp command", () => {
  let transport: StdioClientTransport;
  let client: Client;
  let testNamespace: string;
  const podName = `cp-test-pod-${generateRandomId()}`;
  const NAMESPACE_PREFIX = "test-cp";
  const localOutputDir = path.join(os.tmpdir(), `cp-test-${generateRandomId()}`);

  beforeEach(async () => {
    transport = new StdioClientTransport({
      command: "bun",
      args: ["src/index.ts"],
      stderr: "pipe",
    });

    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
    await sleep(3000);

    testNamespace = `${NAMESPACE_PREFIX}-${generateRandomId()}`;

    // Create namespace
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "create",
            resourceType: "namespace",
            name: testNamespace,
          },
        },
      },
      z.any()
    );

    // Create pod manifest as YAML
    const podManifest = `apiVersion: v1
kind: Pod
metadata:
  name: ${podName}
  namespace: ${testNamespace}
spec:
  containers:
  - name: test-container
    image: busybox
    command: ["sh", "-c", "echo 'HelloWorld' > /tmp/testfile.txt && sleep 3600"]
  restartPolicy: Never`;

    const manifestPath = path.join(os.tmpdir(), `pod-${generateRandomId()}.yaml`);
    await fs.writeFile(manifestPath, podManifest);

    // Apply pod manifest
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "apply",
            args: ["-f", manifestPath],
          },
        },
      },
      z.any()
    );

    // Wait for pod readiness
    let podReady = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!podReady && attempts < maxAttempts) {
      const podStatus = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_generic",
            arguments: {
              command: "get",
              resourceType: "pod",
              name: podName,
              namespace: testNamespace,
              outputFormat: "json",
            },
          },
        },
        z.any()
      );

      const pod = JSON.parse((podStatus as KubectlResponse).content[0].text);
      if (pod.status.phase === "Running") {
        const containerStatuses = pod.status.containerStatuses || [];
        const allReady = containerStatuses.every((s: any) => s.ready);
        if (allReady) podReady = true;
      }

      if (!podReady) {
        await sleep(2000);
        attempts++;
      }
    }

    if (!podReady) throw new Error("Pod failed to become ready within timeout");

    console.log("Pod is ready!");
    await fs.unlink(manifestPath);
  });

  afterEach(async () => {
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "delete",
            resourceType: "namespace",
            name: testNamespace,
            flags: { force: true, "grace-period": "0" },
          },
        },
      },
      z.any()
    );
    await transport.close();
    await sleep(3000);
    await fs.rm(localOutputDir, { recursive: true, force: true });
  });

  test("should copy file from pod to local machine", async () => {
    await fs.mkdir(localOutputDir, { recursive: true });
    const localFilePath = path.join(localOutputDir, "copied-testfile.txt");

    const copyResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_cp",
          arguments: {
            sourceFilePath: `${testNamespace}/${podName}:/tmp/testfile.txt`,
            destinationFilePath: localFilePath,
            container: "test-container",
          },
        },
      },
      z.any()
    );

    console.log("kubectl_cp response:", (copyResponse as KubectlResponse).content[0].text);
    await sleep(2000);

    const fileContents = await fs.readFile(localFilePath, "utf8");
    expect(fileContents.trim()).toBe("HelloWorld");
  }, 120000);

  test("should copy file from local machine to pod", async () => {
    await fs.mkdir(localOutputDir, { recursive: true });

    const localFilePath = path.join(localOutputDir, "test-upload.txt");
    const testContent = "This is a test file for upload";
    await fs.writeFile(localFilePath, testContent);

    const copyResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_cp",
          arguments: {
            sourceFilePath: localFilePath,
            destinationFilePath: `${testNamespace}/${podName}:/tmp/uploaded-file.txt`,
            container: "test-container",
          },
        },
      },
      z.any()
    );

    console.log("kubectl_cp upload response:", (copyResponse as KubectlResponse).content[0].text);
    await sleep(2000);

    const catResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "exec",
            args: [
              `-n=${testNamespace}`,
              podName,
              "--",
              "cat",
              "/tmp/uploaded-file.txt",
            ],
          },
        },
      },
      z.any()
    );

    expect((catResponse as KubectlResponse).content[0].text.trim()).toBe(testContent);
  }, 120000);
});
