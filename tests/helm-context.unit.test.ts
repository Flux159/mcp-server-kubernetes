import { expect, test, describe, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import {
  installHelmChart,
  upgradeHelmChart,
  uninstallHelmChart,
} from "../src/tools/helm-operations.js";

/**
 * The helm tools advertise a `context` parameter. It has to reach helm as
 * --kube-context (and kubectl as --context in template mode); otherwise the
 * release is installed, upgraded or removed in whatever the current
 * kubeconfig context happens to be.
 */

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("helm tools pass the requested kubeconfig context", () => {
  const mockedExecFileSync = vi.mocked(execFileSync);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedExecFileSync.mockReturnValue("" as any);
  });

  function calls(): { file: string; args: string[] }[] {
    return mockedExecFileSync.mock.calls.map((c: any) => ({
      file: c[0] as string,
      args: c[1] as string[],
    }));
  }

  function contextAfter(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  }

  test("install sends --kube-context", async () => {
    const result = await installHelmChart({
      name: "my-release",
      chart: "./charts/mychart",
      namespace: "apps",
      context: "staging",
    });

    expect(JSON.parse(result.content[0].text).status).toBe("installed");
    const install = calls().find((c) => c.args[0] === "install");
    expect(install?.file).toBe("helm");
    expect(contextAfter(install!.args, "--kube-context")).toBe("staging");
  });

  test("install in template mode sends the context to helm and kubectl", async () => {
    const result = await installHelmChart({
      name: "my-release",
      chart: "./charts/mychart",
      namespace: "apps",
      useTemplate: true,
      context: "staging",
    });

    expect(JSON.parse(result.content[0].text).status).toBe("installed");
    const template = calls().find((c) => c.args[0] === "template");
    expect(contextAfter(template!.args, "--kube-context")).toBe("staging");

    const kubectlCalls = calls().filter((c) => c.file === "kubectl");
    expect(kubectlCalls.map((c) => c.args[0])).toEqual(["create", "apply"]);
    for (const call of kubectlCalls) {
      expect(contextAfter(call.args, "--context")).toBe("staging");
    }
  });

  test("upgrade sends --kube-context", async () => {
    await upgradeHelmChart({
      name: "my-release",
      chart: "./charts/mychart",
      namespace: "apps",
      context: "staging",
    });

    const upgrade = calls().find((c) => c.args[0] === "upgrade");
    expect(contextAfter(upgrade!.args, "--kube-context")).toBe("staging");
  });

  test("uninstall sends --kube-context", async () => {
    await uninstallHelmChart({
      name: "my-release",
      namespace: "apps",
      context: "staging",
    });

    const uninstall = calls().find((c) => c.args[0] === "uninstall");
    expect(contextAfter(uninstall!.args, "--kube-context")).toBe("staging");
  });

  test("no context keeps the current kubeconfig context", async () => {
    await installHelmChart({
      name: "my-release",
      chart: "./charts/mychart",
      namespace: "apps",
    });

    const install = calls().find((c) => c.args[0] === "install");
    expect(install!.args).not.toContain("--kube-context");
  });

  test("a flag-shaped context is refused", async () => {
    await expect(
      uninstallHelmChart({
        name: "my-release",
        namespace: "apps",
        context: "--kube-apiserver=https://attacker.example",
      })
    ).rejects.toThrow(/context/);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});
