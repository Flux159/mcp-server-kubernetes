import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { kubectlApply } from "../src/tools/kubectl-apply.js";
import { kubectlDelete } from "../src/tools/kubectl-delete.js";
import {
  installHelmChart,
  upgradeHelmChart,
} from "../src/tools/helm-operations.js";

// On remote (SSE / Streamable HTTP) transports, server-side path params
// resolve on the MCP server host rather than the client's machine, so any
// client that can reach the endpoint could read arbitrary server files.
// These params must be rejected before the child process runs, steering
// clients to the inline-content params (`manifest`, `values`) which are safe
// on all transports. This mirrors the existing kubectl_create guard (see
// tests/kubectl-create-from-file.unit.test.ts).

const TRANSPORT_ENV = [
  "ENABLE_UNSAFE_SSE_TRANSPORT",
  "ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT",
] as const;

// The guards run before any kubectl/helm execution, so a stub manager is fine.
const manager = {} as any;

describe("server-side path params are rejected on remote transports", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    TRANSPORT_ENV.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    TRANSPORT_ENV.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  for (const envVar of TRANSPORT_ENV) {
    test(`kubectl_apply rejects filename under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        kubectlApply(manager, {
          filename: "/etc/passwd",
          dryRun: true,
        })
      ).rejects.toThrow(/'filename'.*disabled on remote/s);
    });

    test(`kubectl_delete rejects filename under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        kubectlDelete(manager, {
          filename: "/etc/passwd",
        })
      ).rejects.toThrow(/'filename'.*disabled on remote/s);
    });

    test(`install_helm_chart rejects valuesFile under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        installHelmChart({
          name: "leak",
          chart: "nginx",
          namespace: "default",
          valuesFile: "/etc/passwd",
        })
      ).rejects.toThrow(/'valuesFile'.*disabled on remote/s);
    });

    test(`install_helm_chart rejects valuesFile in template mode under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        installHelmChart({
          name: "leak",
          chart: "nginx",
          namespace: "default",
          useTemplate: true,
          valuesFile: "/etc/passwd",
        })
      ).rejects.toThrow(/'valuesFile'.*disabled on remote/s);
    });

    test(`upgrade_helm_chart rejects valuesFile under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        upgradeHelmChart({
          name: "leak",
          chart: "nginx",
          namespace: "default",
          valuesFile: "/etc/passwd",
        })
      ).rejects.toThrow(/'valuesFile'.*disabled on remote/s);
    });
  }
});
