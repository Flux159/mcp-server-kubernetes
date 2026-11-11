import { expect, test, describe, vi, beforeEach } from "vitest";
import {
  kubectlTop,
  kubectlTopSchema,
  parseCpuCores,
  parseMemoryBytes,
  parseTopOutput,
} from "../src/tools/kubectl-top.js";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";
import { execFileSync } from "child_process";

/**
 * Unit tests for the kubectl_top tool. child_process.execFileSync (which
 * execFileSyncSafe calls) is mocked so we can assert the exact argv kubectl
 * receives and feed it representative `kubectl top` tables.
 */

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockK8sManager = {} as KubernetesManager;

const NODES_OUTPUT = `NAME           CPU(cores)   CPU(%)   MEMORY(bytes)   MEMORY(%)
control-plane  250m         12%      1024Mi          26%
worker-1       2            50%      3Gi             40%
`;

const PODS_ALL_NS_OUTPUT = `NAMESPACE     NAME                      CPU(cores)   MEMORY(bytes)
kube-system   coredns-abc               3m           14Mi
default       web-7d9f                  120m         256Mi
`;

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("kubectl_top tool", () => {
  const mockedExecFileSync = vi.mocked(execFileSync);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function lastArgs(): string[] {
    const calls = mockedExecFileSync.mock.calls;
    return calls[calls.length - 1][1] as string[];
  }

  test("schema is read-only and requires context", () => {
    expect(kubectlTopSchema.annotations.readOnlyHint).toBe(true);
    expect(kubectlTopSchema.inputSchema.required).toEqual([
      "resourceType",
      "context",
    ]);
  });

  test("returns structured node metrics", async () => {
    mockedExecFileSync.mockReturnValue(NODES_OUTPUT);

    const result = await kubectlTop(mockK8sManager, {
      resourceType: "nodes",
      context: "prod",
    });

    expect(lastArgs()).toEqual(["top", "nodes", "--context", "prod"]);
    const body = parse(result);
    expect(body.resourceType).toBe("nodes");
    expect(body.context).toBe("prod");
    expect(body.raw).toBeUndefined();
    expect(body.items).toEqual([
      {
        name: "control-plane",
        cpu: "250m",
        memory: "1024Mi",
        cpuPercent: "12%",
        memoryPercent: "26%",
        cpuCores: 0.25,
        memoryBytes: 1024 * 1024 * 1024,
      },
      {
        name: "worker-1",
        cpu: "2",
        memory: "3Gi",
        cpuPercent: "50%",
        memoryPercent: "40%",
        cpuCores: 2,
        memoryBytes: 3 * 1024 ** 3,
      },
    ]);
  });

  test("passes a single node name and includes raw output on request", async () => {
    mockedExecFileSync.mockReturnValue(NODES_OUTPUT);

    const result = await kubectlTop(mockK8sManager, {
      resourceType: "nodes",
      name: "worker-1",
      context: "prod",
      includeRaw: true,
    });

    expect(lastArgs()).toEqual([
      "top",
      "nodes",
      "worker-1",
      "--context",
      "prod",
    ]);
    expect(parse(result).raw).toBe(NODES_OUTPUT);
  });

  test("returns pod metrics across all namespaces", async () => {
    mockedExecFileSync.mockReturnValue(PODS_ALL_NS_OUTPUT);

    const result = await kubectlTop(mockK8sManager, {
      resourceType: "pods",
      allNamespaces: true,
      context: "dev",
    });

    expect(lastArgs()).toEqual([
      "top",
      "pods",
      "--all-namespaces",
      "--context",
      "dev",
    ]);
    const body = parse(result);
    expect(body.namespace).toBe("all");
    expect(body.items[0]).toEqual({
      name: "coredns-abc",
      namespace: "kube-system",
      cpu: "3m",
      memory: "14Mi",
      cpuCores: 0.003,
      memoryBytes: 14 * 1024 * 1024,
    });
  });

  test("scopes pods to the given namespace, defaulting to 'default'", async () => {
    mockedExecFileSync.mockReturnValue(
      "NAME   CPU(cores)   MEMORY(bytes)\nweb    1m           8Mi\n"
    );

    await kubectlTop(mockK8sManager, {
      resourceType: "pods",
      namespace: "apps",
      context: "dev",
    });
    expect(lastArgs()).toEqual([
      "top",
      "pods",
      "-n",
      "apps",
      "--context",
      "dev",
    ]);

    const result = await kubectlTop(mockK8sManager, {
      resourceType: "pods",
      context: "dev",
    });
    expect(lastArgs()).toEqual([
      "top",
      "pods",
      "-n",
      "default",
      "--context",
      "dev",
    ]);
    expect(parse(result).namespace).toBe("default");
  });

  test("rejects a missing or blank context without calling kubectl", async () => {
    for (const context of [undefined, "", "   "]) {
      await expect(
        kubectlTop(mockK8sManager, {
          resourceType: "nodes",
          context: context as any,
        })
      ).rejects.toThrow(/context is required/);
    }
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  test("rejects an unsupported resourceType", async () => {
    await expect(
      kubectlTop(mockK8sManager, { resourceType: "deployments", context: "x" })
    ).rejects.toThrow(/must be "nodes" or "pods"/);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  test("rejects flag-shaped name and namespace", async () => {
    await expect(
      kubectlTop(mockK8sManager, {
        resourceType: "nodes",
        name: "--server=https://attacker",
        context: "x",
      })
    ).rejects.toThrow(/name/);
    await expect(
      kubectlTop(mockK8sManager, {
        resourceType: "pods",
        namespace: "-A",
        context: "x",
      })
    ).rejects.toThrow(/namespace/);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  test("returns an actionable error when the Metrics API is unavailable", async () => {
    mockedExecFileSync.mockImplementation(() => {
      const err: any = new Error("Command failed: kubectl top nodes");
      err.stderr = "error: Metrics API not available\n";
      throw err;
    });

    const result: any = await kubectlTop(mockK8sManager, {
      resourceType: "nodes",
      context: "kind",
    });

    expect(result.isError).toBe(true);
    const body = parse(result);
    expect(body.status).toBe("metrics_unavailable");
    expect(body.context).toBe("kind");
    expect(body.hint).toMatch(/metrics-server/);
  });

  test("surfaces other kubectl failures as errors", async () => {
    mockedExecFileSync.mockImplementation(() => {
      const err: any = new Error("Command failed");
      err.stderr = 'error: context "nope" does not exist';
      throw err;
    });

    await expect(
      kubectlTop(mockK8sManager, { resourceType: "nodes", context: "nope" })
    ).rejects.toThrow(/context "nope" does not exist/);
  });
});

describe("kubectl_top parsing helpers", () => {
  test("parseCpuCores handles kubectl CPU quantities", () => {
    expect(parseCpuCores("250m")).toBe(0.25);
    expect(parseCpuCores("2")).toBe(2);
    expect(parseCpuCores("1500000n")).toBe(0.0015);
    expect(parseCpuCores("<unknown>")).toBeUndefined();
  });

  test("parseMemoryBytes handles binary and decimal suffixes", () => {
    expect(parseMemoryBytes("128Mi")).toBe(128 * 1024 * 1024);
    expect(parseMemoryBytes("1G")).toBe(1e9);
    expect(parseMemoryBytes("512Ki")).toBe(512 * 1024);
    expect(parseMemoryBytes("4096")).toBe(4096);
    expect(parseMemoryBytes("<unknown>")).toBeUndefined();
  });

  test("parseTopOutput accepts the older CPU%/MEMORY% headers", () => {
    const items = parseTopOutput(
      "NAME   CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%\nn1     100m         5%     200Mi           10%\n"
    );
    expect(items[0].cpuPercent).toBe("5%");
    expect(items[0].memoryPercent).toBe("10%");
  });

  test("parseTopOutput keeps nodes without metrics but omits numeric fields", () => {
    const items = parseTopOutput(
      "NAME   CPU(cores)   CPU(%)      MEMORY(bytes)   MEMORY(%)\nn1     <unknown>    <unknown>   <unknown>       <unknown>\n"
    );
    expect(items[0]).toEqual({
      name: "n1",
      cpu: "<unknown>",
      memory: "<unknown>",
      cpuPercent: "<unknown>",
      memoryPercent: "<unknown>",
    });
  });

  test("parseTopOutput returns no items for empty output", () => {
    expect(parseTopOutput("")).toEqual([]);
  });
});
