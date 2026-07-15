import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { kubectlGet } from "../src/tools/kubectl-get.js";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";
import { execFileSync } from "child_process";

/**
 * Unit tests for the kubectl_get tool's `output: "custom"` path.
 *
 * Regression coverage for the same class of bug fixed in kubectl-logs (#338):
 * the custom-columns output format was built with LITERAL single quotes
 * ("-o 'custom-columns=...'"). Those quotes are shell syntax, but
 * execFileSyncSafe runs kubectl via execFileSync (no shell), so kubectl
 * received them verbatim and rejected the output format as unknown
 * ("unable to match a printer suitable for the output format \"'custom-columns=...\"").
 *
 * Strategy: mock child_process.execFileSync (which execFileSyncSafe calls) so
 * we can assert the exact argv kubectl receives.
 */

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

const CUSTOM_TABLE =
  "NAME         NAMESPACE     STATUS    AGE\n" +
  "coredns-abc  kube-system   Running   2026-07-15T00:00:00Z\n";

const mockK8sManager = {} as KubernetesManager;

describe("kubectl_get tool custom output", () => {
  const mockedExecFileSync = vi.mocked(execFileSync);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedExecFileSync.mockReturnValue(CUSTOM_TABLE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function argvOf(callIndex: number): string[] {
    return mockedExecFileSync.mock.calls[callIndex][1] as string[];
  }

  // Regression: the -o value must be a bare custom-columns spec, with no
  // literal single quotes, since there is no shell to strip them.
  test("custom output builds an unquoted custom-columns argument", async () => {
    const result = await kubectlGet(mockK8sManager, {
      resourceType: "pods",
      namespace: "kube-system",
      output: "custom",
    });

    const argv = argvOf(0);
    const outFlag = argv.indexOf("-o");
    expect(outFlag).toBeGreaterThan(-1);
    expect(argv[outFlag + 1]).toBe(
      "custom-columns=NAME:.metadata.name,NAMESPACE:.metadata.namespace,STATUS:.status.phase,AGE:.metadata.creationTimestamp"
    );
    for (const tok of argv) {
      expect(tok).not.toContain("'");
    }

    expect(result.content[0].text).toBe(CUSTOM_TABLE);
  });

  test("custom output for events uses the event columns, unquoted", async () => {
    await kubectlGet(mockK8sManager, {
      resourceType: "events",
      output: "custom",
    });

    const argv = argvOf(0);
    const outFlag = argv.indexOf("-o");
    expect(argv[outFlag + 1]).toBe(
      "custom-columns=LASTSEEN:.lastTimestamp,TYPE:.type,REASON:.reason,OBJECT:.involvedObject.name,MESSAGE:.message"
    );
    for (const tok of argv) {
      expect(tok).not.toContain("'");
    }
  });
});
