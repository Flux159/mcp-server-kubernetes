import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  installHelmChart,
  upgradeHelmChart,
  uninstallHelmChart,
} from "../src/tools/helm-operations.js";

// The helm tools put caller-supplied values into positional argv slots
// ("helm install <name> <chart>"). pflag parses any token starting with "-"
// as a flag wherever it appears, so those operands must be refused before
// helm is spawned — otherwise a tool argument becomes a helm flag.
describe("helm tools reject flag-shaped operands", () => {
  const originalEnv = process.env.ALLOW_KUBECTL_UNSAFE_FLAGS;

  beforeEach(() => {
    delete process.env.ALLOW_KUBECTL_UNSAFE_FLAGS;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_KUBECTL_UNSAFE_FLAGS;
    } else {
      process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = originalEnv;
    }
  });

  const flagShaped = "--post-renderer=/tmp/payload.sh";

  test("install rejects a flag-shaped release name (template mode)", async () => {
    await expect(
      installHelmChart({
        name: flagShaped,
        chart: "./charts/mychart",
        namespace: "default",
        useTemplate: true,
        createNamespace: true,
      })
    ).rejects.toThrow(McpError);
  });

  test("install rejects a flag-shaped release name (helm install mode)", async () => {
    await expect(
      installHelmChart({
        name: flagShaped,
        chart: "./charts/mychart",
        namespace: "default",
      })
    ).rejects.toThrow(/release name/);
  });

  test("install rejects flag-shaped chart, namespace and repo", async () => {
    await expect(
      installHelmChart({
        name: "my-release",
        chart: flagShaped,
        namespace: "default",
      })
    ).rejects.toThrow(/chart/);

    await expect(
      installHelmChart({
        name: "my-release",
        chart: "./charts/mychart",
        namespace: flagShaped,
      })
    ).rejects.toThrow(/namespace/);

    await expect(
      installHelmChart({
        name: "my-release",
        chart: "bitnami/nginx",
        namespace: "default",
        repo: flagShaped,
      })
    ).rejects.toThrow(/repo/);
  });

  test("upgrade rejects a flag-shaped release name", async () => {
    await expect(
      upgradeHelmChart({
        name: flagShaped,
        chart: "./charts/mychart",
        namespace: "default",
      })
    ).rejects.toThrow(McpError);
  });

  test("uninstall rejects a flag-shaped release name", async () => {
    await expect(
      uninstallHelmChart({
        name: flagShaped,
        namespace: "default",
      })
    ).rejects.toThrow(McpError);
  });

  test("rejection is an InvalidParams McpError, not a 'failed' tool result", async () => {
    // The tools catch helm failures and return { status: "failed" }; the guard
    // has to fire before that so the caller sees a hard protocol error.
    try {
      await installHelmChart({
        name: flagShaped,
        chart: "./charts/mychart",
        namespace: "default",
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(McpError);
      expect((e as McpError).code).toBe(ErrorCode.InvalidParams);
    }
  });
});
