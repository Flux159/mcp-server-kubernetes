import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { kubectlCreate } from "../src/tools/kubectl-create.js";

// kubectl_create builds "--from-file=<key>=<tempfile>" from fromFileContent
// and "-o <output>" from output. kubectl splits --from-file on commas and
// reads a file for some output formats, so both values are validated before
// anything is written or run.

const TRANSPORT_ENV = [
  "ENABLE_UNSAFE_SSE_TRANSPORT",
  "ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT",
] as const;

// Validation runs before any kubectl execution, so a stub manager is fine.
const manager = {} as any;

describe("kubectl_create input validation", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    TRANSPORT_ENV.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "true";
  });

  afterEach(() => {
    TRANSPORT_ENV.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  const badKeys: [string, unknown][] = [
    ["comma-separated extra source", "leak=/etc/passwd,x"],
    ["directory source", "/var/run/secrets/kubernetes.io/serviceaccount,x"],
    ["embedded =", "a=b"],
    ["path separator", "../x"],
    ["array", ["leak=/etc/passwd,x"]],
  ];

  for (const [label, key] of badKeys) {
    for (const resourceType of ["configmap", "secret"]) {
      test(`rejects a fromFileContent key with ${label} (${resourceType})`, async () => {
        await expect(
          kubectlCreate(manager, {
            resourceType,
            secretType: "generic",
            name: "x",
            dryRun: true,
            fromFileContent: [{ key: key as any, content: "a" }],
          } as any)
        ).rejects.toThrow(/Invalid fromFileContent key/);
      });
    }
  }

  const badOutputs = [
    "templatefile=/etc/passwd",
    "go-template-file=/etc/passwd",
    "jsonpath-file=/etc/passwd",
    "custom-columns-file=/etc/passwd",
    "raw",
  ];

  for (const output of badOutputs) {
    test(`rejects output "${output}"`, async () => {
      await expect(
        kubectlCreate(manager, {
          resourceType: "namespace",
          name: "x",
          dryRun: true,
          output,
        } as any)
      ).rejects.toThrow(/Unsupported output format/);
    });
  }
});
