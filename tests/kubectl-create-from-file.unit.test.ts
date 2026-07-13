import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { isRemoteTransport } from "../src/security/transport.js";
import { kubectlCreate } from "../src/tools/kubectl-create.js";

// GHSA-m67f-jxm9-cvx8: on remote (SSE / Streamable HTTP) transports the
// server-side path params `filename` (-f) and `fromFile` (--from-file) let any
// client read arbitrary files from the MCP server host. These must be rejected
// before kubectl runs, and clients steered to the inline-content params
// (`manifest`, `fromFileContent`) which are safe on all transports.

const TRANSPORT_ENV = [
  "ENABLE_UNSAFE_SSE_TRANSPORT",
  "ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT",
] as const;

describe("isRemoteTransport", () => {
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

  test("false when no transport env var is set (stdio)", () => {
    expect(isRemoteTransport()).toBe(false);
  });

  test("true when the SSE transport is enabled", () => {
    process.env.ENABLE_UNSAFE_SSE_TRANSPORT = "true";
    expect(isRemoteTransport()).toBe(true);
  });

  test("true when the Streamable HTTP transport is enabled", () => {
    process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "true";
    expect(isRemoteTransport()).toBe(true);
  });
});

describe("kubectlCreate rejects server-side file reads on remote transports", () => {
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

  // The guard runs before any kubectl execution, so a stub manager is fine.
  const manager = {} as any;

  for (const envVar of TRANSPORT_ENV) {
    test(`rejects fromFile under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        kubectlCreate(manager, {
          resourceType: "configmap",
          name: "leak",
          fromFile: ["/etc/passwd"],
          dryRun: true,
        })
      ).rejects.toThrow(/'fromFile'.*disabled on remote/s);
    });

    test(`rejects filename under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        kubectlCreate(manager, {
          filename: "/etc/passwd",
          dryRun: true,
        })
      ).rejects.toThrow(/'filename'.*disabled on remote/s);
    });
  }

  test("allows fromFileContent under a remote transport", async () => {
    process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "true";
    // The inline-content path carries no server-side path, so it is safe on
    // remote transports. dryRun renders the resource without touching the
    // cluster; the client-provided content lands under the requested key.
    const result: any = await kubectlCreate(manager, {
      resourceType: "configmap",
      name: "cfg",
      fromFileContent: [{ key: "app.conf", content: "hello=world" }],
      dryRun: true,
    });
    const text = result.content[0].text;
    expect(text).toMatch(/app\.conf: hello=world/);
    expect(text).toMatch(/kind: ConfigMap/);
  });
});
