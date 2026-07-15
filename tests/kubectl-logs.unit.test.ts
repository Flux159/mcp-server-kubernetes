import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { kubectlLogs } from "../src/tools/kubectl-logs.js";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";
import { execFileSync } from "child_process";

/**
 * Unit tests for the kubectl_logs tool.
 *
 * Regression coverage for two bugs that made every log fetch fail on
 * flux159/mcp-server-kubernetes v3.9.0 once the tool moved to shell-less
 * execFileSync:
 *
 *  1. Pod path threw "Cannot read properties of undefined (reading
 *     'toLowerCase')" whenever resourceType was omitted, because the schema
 *     marks it required but the MCP SDK does not enforce it, so `undefined`
 *     reached `input.resourceType.toLowerCase()`.
 *
 *  2. Deployment/job/cronjob path built `-o jsonpath='{...}'` with LITERAL
 *     single quotes. Under execFileSync (no shell to strip them) kubectl
 *     emitted `'{"k8s-app":"kube-dns"}'`; the handler then did
 *     `.replace(/'/g, '"')` -> `"{"k8s-app"...` and JSON.parse died with
 *     "Unexpected non-whitespace character after JSON at position 3".
 *
 * Strategy: mock child_process.execFileSync (which execFileSyncSafe calls) so
 * we can assert both the exact argv kubectl receives and that plain-text log
 * output is returned verbatim rather than parsed as JSON.
 */

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// A plain-text log line whose 4th character (position 3) is non-whitespace,
// i.e. exactly the shape that broke JSON.parse in the original bug. If any
// code path ever JSON.parses raw log output again, these assertions fail.
const PLAIN_LOG = "2026-07-15T12:00:00Z [INFO] plugin/reload: config loaded\n";

const mockK8sManager = {} as KubernetesManager;

describe("kubectl_logs tool", () => {
  const mockedExecFileSync = vi.mocked(execFileSync);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Route kubectl invocations by their argv so a single mock can serve the
  // multi-step deployment path (get selector -> get pods -> logs per pod).
  function routeKubectl(returns: {
    selector?: string;
    pods?: string;
    logs?: string;
  }) {
    mockedExecFileSync.mockImplementation((_file: any, args: any) => {
      const argv: string[] = args;
      if (argv.includes("logs")) return returns.logs ?? PLAIN_LOG;
      if (argv.includes("get") && argv.includes("pods"))
        return returns.pods ?? "";
      if (argv.includes("get")) return returns.selector ?? "";
      return "";
    });
  }

  function allArgs(): string[][] {
    return mockedExecFileSync.mock.calls.map((c: any) => c[1] as string[]);
  }

  test("pod path returns plain-text logs verbatim (with explicit container)", async () => {
    routeKubectl({ logs: PLAIN_LOG });

    const result = await kubectlLogs(mockK8sManager, {
      resourceType: "pod",
      name: "coredns-abc",
      namespace: "kube-system",
      container: "coredns",
      tail: 5,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe("coredns-abc");
    expect(data.logs).toBe(PLAIN_LOG);

    const argv = allArgs()[0];
    expect(argv).toEqual([
      "-n",
      "kube-system",
      "logs",
      "coredns-abc",
      "-c",
      "coredns",
      "--tail=5",
    ]);
  });

  test("pod path works with no container arg", async () => {
    routeKubectl({ logs: PLAIN_LOG });

    const result = await kubectlLogs(mockK8sManager, {
      resourceType: "pod",
      name: "coredns-abc",
      namespace: "kube-system",
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.logs).toBe(PLAIN_LOG);
    expect(allArgs()[0]).not.toContain("-c");
  });

  // Regression: resourceType omitted must NOT crash on `.toLowerCase()`; it
  // defaults to "pod" and returns logs.
  test("defaults to pod when resourceType is omitted (toLowerCase regression)", async () => {
    routeKubectl({ logs: PLAIN_LOG });

    const result = await kubectlLogs(mockK8sManager, {
      // resourceType intentionally omitted
      name: "coredns-abc",
      namespace: "kube-system",
      tail: 3,
    } as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe("coredns-abc");
    expect(data.logs).toBe(PLAIN_LOG);
    // Took the pod branch: a `logs` invocation happened.
    expect(allArgs().some((a) => a.includes("logs"))).toBe(true);
  });

  test("deployment path resolves selector and returns per-pod logs", async () => {
    routeKubectl({
      selector: '{"k8s-app":"kube-dns"}',
      pods: "coredns-1 coredns-2",
      logs: PLAIN_LOG,
    });

    const result = await kubectlLogs(mockK8sManager, {
      resourceType: "deployment",
      name: "coredns",
      namespace: "kube-system",
      tail: 3,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.selector).toBe("k8s-app=kube-dns");
    expect(Object.keys(data.logs)).toEqual(["coredns-1", "coredns-2"]);
    expect(data.logs["coredns-1"]).toBe(PLAIN_LOG);
    expect(data.logs["coredns-2"]).toBe(PLAIN_LOG);
  });

  // Regression: the jsonpath argv must not carry literal single quotes, since
  // there is no shell to strip them under execFileSync.
  test("jsonpath argv contains no literal single quotes", async () => {
    routeKubectl({
      selector: '{"k8s-app":"kube-dns"}',
      pods: "coredns-1",
      logs: PLAIN_LOG,
    });

    await kubectlLogs(mockK8sManager, {
      resourceType: "deployment",
      name: "coredns",
      namespace: "kube-system",
    });

    const flat = allArgs().flat();
    expect(flat).toContain("jsonpath={.spec.selector.matchLabels}");
    for (const tok of flat) {
      expect(tok).not.toContain("'");
    }
  });
});
