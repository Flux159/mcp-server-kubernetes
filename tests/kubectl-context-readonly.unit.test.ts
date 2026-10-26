import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { kubectlContext, kubectlContextSchema } from "../src/tools/kubectl-context.js";
import { execFileSync } from "child_process";

// "set" rewrites the kubeconfig's current-context, so it must not be
// reachable in read-only mode, and the tool must not advertise itself as
// read-only to clients that skip confirmation for read-only tools.

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

const manager = {} as any;

describe("kubectl_context in read-only mode", () => {
  const mockedExecFileSync = vi.mocked(execFileSync);
  let saved: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    saved = process.env.ALLOW_ONLY_READONLY_TOOLS;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOW_ONLY_READONLY_TOOLS;
    else process.env.ALLOW_ONLY_READONLY_TOOLS = saved;
  });

  test("does not declare readOnlyHint", () => {
    expect(kubectlContextSchema.annotations.readOnlyHint).toBe(false);
  });

  test("refuses set without running kubectl", async () => {
    process.env.ALLOW_ONLY_READONLY_TOOLS = "true";
    await expect(
      kubectlContext(manager, { operation: "set", name: "other" })
    ).rejects.toThrow(/disabled in read-only mode/);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  test("still allows get", async () => {
    process.env.ALLOW_ONLY_READONLY_TOOLS = "true";
    mockedExecFileSync.mockReturnValue("prod\n" as any);
    const result: any = await kubectlContext(manager, { operation: "get" });
    expect(JSON.stringify(result)).toContain("prod");
  });

  test("allows set outside read-only mode", async () => {
    delete process.env.ALLOW_ONLY_READONLY_TOOLS;
    mockedExecFileSync.mockReturnValue("other\n" as any);
    await expect(
      kubectlContext(manager, { operation: "set", name: "other" })
    ).resolves.toBeDefined();
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "kubectl",
      ["config", "use-context", "other"],
      expect.anything()
    );
  });
});
