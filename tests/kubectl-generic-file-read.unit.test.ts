import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { assertNoRemoteFileReads } from "../src/security/kubectl-flags.js";
import { kubectlGeneric } from "../src/tools/kubectl-generic.js";

// kubectl_generic hands the caller a free-form kubectl argv, so the
// per-parameter path guards the structured tools use (`filename`, `fromFile`,
// `patchFile`, `valuesFile`) have nothing to attach to here: the same
// server-side read arrives as a raw "--from-file=leak=/etc/passwd" token and
// kubectl reflects the file back under --dry-run=client, without a cluster.
// On remote transports that is an arbitrary file read on the server host; on
// stdio the files are the operator's own and the flags stay allowed.

const TRANSPORT_ENV = [
  "ENABLE_UNSAFE_SSE_TRANSPORT",
  "ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT",
] as const;

// The guard runs before any kubectl execution, so a stub manager is fine.
const manager = {} as any;

describe("assertNoRemoteFileReads", () => {
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

  describe("under stdio", () => {
    test("allows file-reading flags: the paths are the operator's own", () => {
      expect(() =>
        assertNoRemoteFileReads(["apply", "-f", "/home/me/app.yaml"])
      ).not.toThrow();
      expect(() =>
        assertNoRemoteFileReads([
          "create",
          "configmap",
          "cfg",
          "--from-file=/home/me/app.conf",
        ])
      ).not.toThrow();
    });
  });

  describe("under a remote transport", () => {
    beforeEach(() => {
      process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "true";
    });

    // Every spelling pflag accepts for the file-reading flags.
    const rejected: [string, string[]][] = [
      ["long joined", ["--from-file=leak=/etc/passwd"]],
      ["long split", ["--from-file", "leak=/etc/passwd"]],
      ["long underscore alias", ["--from_file=leak=/etc/passwd"]],
      ["--filename", ["--filename=/etc/passwd"]],
      ["--from-env-file", ["--from-env-file=/proc/self/environ"]],
      ["--kustomize", ["--kustomize=/etc"]],
      ["--patch-file", ["--patch-file=/etc/passwd"]],
      ["short split", ["-f", "/etc/passwd"]],
      ["short attached", ["-f/etc/passwd"]],
      ["short clustered", ["-Rf/etc/passwd"]],
      ["short -k", ["-k/etc"]],
      ["-o go-template-file split", ["-o", "go-template-file=/etc/passwd"]],
      ["-o go-template-file attached", ["-ogo-template-file=/etc/passwd"]],
      ["-o=jsonpath-file", ["-o=jsonpath-file=/etc/passwd"]],
      ["--output=go-template-file", ["--output=go-template-file=/etc/passwd"]],
    ];

    for (const [label, argv] of rejected) {
      test(`rejects ${label}`, () => {
        expect(() => assertNoRemoteFileReads(["create", ...argv])).toThrow(
          /reads a file from the MCP server's own filesystem/
        );
      });
    }

    test("leaves benign argv alone", () => {
      expect(() =>
        assertNoRemoteFileReads([
          "get",
          "pods",
          "--namespace=default",
          "-o=json",
          "-l",
          "app=frontend",
          "--context",
          "prod",
        ])
      ).not.toThrow();
    });
  });
});

describe("kubectl_generic rejects server-side file reads on remote transports", () => {
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
    test(`rejects --from-file passed through args under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        kubectlGeneric(manager, {
          command: "create",
          resourceType: "configmap",
          name: "leak",
          args: ["--from-file=leak=/proc/self/environ", "--dry-run=client"],
          outputFormat: "yaml",
        })
      ).rejects.toThrow(/reads a file from the MCP server's own filesystem/);
    });

    test(`rejects --from-file passed through the flags object under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        kubectlGeneric(manager, {
          command: "create",
          resourceType: "configmap",
          name: "leak",
          flags: { "from-file": "leak=/etc/passwd", "dry-run": "client" },
        })
      ).rejects.toThrow(/reads a file from the MCP server's own filesystem/);
    });

    test(`rejects a file flag smuggled through a positional slot under ${envVar}`, async () => {
      process.env[envVar] = "true";
      await expect(
        kubectlGeneric(manager, {
          command: "create",
          resourceType: "--from-file=leak=/etc/passwd",
        })
      ).rejects.toThrow(/reads a file from the MCP server's own filesystem/);
    });
  }
});
