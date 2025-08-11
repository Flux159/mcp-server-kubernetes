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
  const localOutputDir = path.join(
    os.tmpdir(),
    `cp-test-${generateRandomId()}`
  );

  beforeEach(async () => {
    transport = new StdioClientTransport({
      command: "bun",
      args: ["src/index.ts"],
      stderr: "pipe",
      env: process.env as Record<string, string>, // Ensure the MCP server inherits the current environment
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

    // Create RBAC role and binding
    const rbacManifest = `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: pod-file-access-${testNamespace}
rules:
- apiGroups: [""]
  resources: ["pods", "pods/exec", "pods/portforward"]
  verbs: ["get", "list", "create", "delete", "watch"]
- apiGroups: [""]
  resources: ["pods/ephemeral"]
  verbs: ["create", "delete"]
- apiGroups: [""]
  resources: ["pods/attach"]
  verbs: ["create", "get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: pod-file-access-binding-${testNamespace}
subjects:
- kind: ServiceAccount
  name: default
  namespace: ${testNamespace}
roleRef:
  kind: ClusterRole
  name: pod-file-access-${testNamespace}
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: default
  namespace: ${testNamespace}`;

    const rbacPath = path.join(
      os.tmpdir(),
      `rbac-${generateRandomId()}.yaml`
    );
    await fs.writeFile(rbacPath, rbacManifest);

    // Apply RBAC manifest
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "apply",
            args: ["-f", rbacPath],
          },
        },
      },
      z.any()
    );
    await fs.unlink(rbacPath);

    // Create pod manifest as YAML
    const podManifest = `apiVersion: v1
kind: Pod
metadata:
  name: ${podName}
  namespace: ${testNamespace}
spec:
  serviceAccountName: default
  containers:
  - name: test-container
    image: busybox
    command: ["sh", "-c", "echo 'HelloWorld' > /tmp/testfile.txt && sleep 3600"]
    securityContext:
      runAsUser: 0
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
      readOnlyRootFilesystem: false
    volumeMounts:
    - name: tmp-volume
      mountPath: /tmp
  volumes:
  - name: tmp-volume
    emptyDir: {}
  securityContext:
    fsGroup: 0
    runAsNonRoot: false
    seccompProfile:
      type: RuntimeDefault
  restartPolicy: Never`;

    const manifestPath = path.join(
      os.tmpdir(),
      `pod-${generateRandomId()}.yaml`
    );
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
    // Delete the ClusterRole and ClusterRoleBinding first
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "delete",
            resourceType: "clusterrole",
            name: `pod-file-access-${testNamespace}`,
            flags: { force: true, "grace-period": "0" },
          },
        },
      },
      z.any()
    );

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_generic",
          arguments: {
            command: "delete",
            resourceType: "clusterrolebinding",
            name: `pod-file-access-binding-${testNamespace}`,
            flags: { force: true, "grace-period": "0" },
          },
        },
      },
      z.any()
    );

    // Then delete the namespace
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

    console.log(
      "kubectl_cp response:",
      (copyResponse as KubectlResponse).content[0].text
    );
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

    console.log(
      "kubectl_cp upload response:",
      (copyResponse as KubectlResponse).content[0].text
    );
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

    expect((catResponse as KubectlResponse).content[0].text.trim()).toBe(
      testContent
    );
  }, 120000);
});