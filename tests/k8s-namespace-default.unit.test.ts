import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { kubectlGet } from "../src/tools/kubectl-get.js";
import { kubectlScale } from "../src/tools/kubectl-scale.js";
import { kubectlDelete } from "../src/tools/kubectl-delete.js";
import { kubectlDescribe } from "../src/tools/kubectl-describe.js";
import { kubectlLogs } from "../src/tools/kubectl-logs.js";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";

/**
 * ADVANCED_README documents K8S_NAMESPACE as the default namespace override.
 * Tool calls without a namespace have to use it instead of "default".
 */

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

const k8sManager = {} as KubernetesManager;

function namespaceOf(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-n" || args[i] === "--namespace") {
      return args[i + 1];
    }
    if (args[i].startsWith("--namespace=")) {
      return args[i].slice("--namespace=".length);
    }
  }
  return undefined;
}

describe("K8S_NAMESPACE is the default namespace of the tools", () => {
  const mockedExecFileSync = vi.mocked(execFileSync);
  const originalNamespace = process.env.K8S_NAMESPACE;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedExecFileSync.mockReturnValue('{"items":[]}' as any);
    process.env.K8S_NAMESPACE = "team-a";
  });

  afterEach(() => {
    if (originalNamespace === undefined) {
      delete process.env.K8S_NAMESPACE;
    } else {
      process.env.K8S_NAMESPACE = originalNamespace;
    }
  });

  function lastArgs(): string[] {
    const calls = mockedExecFileSync.mock.calls;
    return calls[calls.length - 1][1] as string[];
  }

  test("kubectl_get", async () => {
    await kubectlGet(k8sManager, { resourceType: "pods" });
    expect(namespaceOf(lastArgs())).toBe("team-a");
  });

  test("kubectl_scale", async () => {
    await kubectlScale(k8sManager, { name: "web", replicas: 2 });
    expect(namespaceOf(lastArgs())).toBe("team-a");
  });

  test("kubectl_delete", async () => {
    await kubectlDelete(k8sManager, { resourceType: "pod", name: "web-0" });
    expect(namespaceOf(lastArgs())).toBe("team-a");
  });

  test("kubectl_describe", async () => {
    await kubectlDescribe(k8sManager, { resourceType: "pod", name: "web-0" });
    expect(namespaceOf(lastArgs())).toBe("team-a");
  });

  test("kubectl_logs", async () => {
    await kubectlLogs(k8sManager, { resourceType: "pod", name: "web-0" });
    expect(namespaceOf(lastArgs())).toBe("team-a");
  });

  test("an explicit namespace still wins", async () => {
    await kubectlGet(k8sManager, { resourceType: "pods", namespace: "kube-system" });
    expect(namespaceOf(lastArgs())).toBe("kube-system");
  });

  test("without K8S_NAMESPACE the tools keep using default", async () => {
    delete process.env.K8S_NAMESPACE;
    await kubectlGet(k8sManager, { resourceType: "pods" });
    expect(namespaceOf(lastArgs())).toBe("default");
  });
});
