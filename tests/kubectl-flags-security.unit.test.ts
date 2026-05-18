import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { assertNoDangerousFlags } from "../src/security/kubectl-flags.js";
import { kubectlGeneric } from "../src/tools/kubectl-generic.js";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";

describe("assertNoDangerousFlags", () => {
  const originalEnv = process.env.ALLOW_KUBECTL_UNSAFE_FLAGS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_KUBECTL_UNSAFE_FLAGS;
    } else {
      process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = originalEnv;
    }
  });

  describe("flags object", () => {
    test("rejects --server", () => {
      expect(() =>
        assertNoDangerousFlags({ server: "https://attacker.example.com" })
      ).toThrow(McpError);
    });

    test("rejects --insecure-skip-tls-verify", () => {
      expect(() =>
        assertNoDangerousFlags({ "insecure-skip-tls-verify": "true" })
      ).toThrow(/insecure-skip-tls-verify/);
    });

    test("rejects --token", () => {
      expect(() => assertNoDangerousFlags({ token: "abc" })).toThrow(/token/);
    });

    test("rejects --kubeconfig (alternate kubeconfig file)", () => {
      expect(() =>
        assertNoDangerousFlags({ kubeconfig: "/tmp/evil.yaml" })
      ).toThrow(/kubeconfig/);
    });

    test("rejects impersonation flag --as", () => {
      expect(() =>
        assertNoDangerousFlags({ as: "system:admin" })
      ).toThrow(/--as/);
    });

    test("rejection is case-insensitive", () => {
      expect(() =>
        assertNoDangerousFlags({ SERVER: "https://attacker" })
      ).toThrow(McpError);
    });

    test("allows benign flags through", () => {
      expect(() =>
        assertNoDangerousFlags({
          "from-literal": "key=value",
          output: "json",
          "dry-run": "client",
        })
      ).not.toThrow();
    });

    test("undefined / empty inputs are fine", () => {
      expect(() => assertNoDangerousFlags()).not.toThrow();
      expect(() => assertNoDangerousFlags({}, [])).not.toThrow();
    });

    test("error uses InvalidParams code", () => {
      try {
        assertNoDangerousFlags({ server: "x" });
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(McpError);
        expect((e as McpError).code).toBe(ErrorCode.InvalidParams);
      }
    });
  });

  describe("args array", () => {
    test("rejects joined form '--server=...'", () => {
      expect(() =>
        assertNoDangerousFlags(undefined, ["--server=https://attacker"])
      ).toThrow(/--server/);
    });

    test("rejects split form '--server' 'value'", () => {
      expect(() =>
        assertNoDangerousFlags(undefined, ["--server", "https://attacker"])
      ).toThrow(/--server/);
    });

    test("rejects short alias -s", () => {
      expect(() =>
        assertNoDangerousFlags(undefined, ["-s", "https://attacker"])
      ).toThrow(/-s/);
    });

    test("rejects --insecure-skip-tls-verify=true in args", () => {
      expect(() =>
        assertNoDangerousFlags(undefined, ["--insecure-skip-tls-verify=true"])
      ).toThrow(McpError);
    });

    test("rejects --token in args", () => {
      expect(() =>
        assertNoDangerousFlags(undefined, ["--token=stolen"])
      ).toThrow(/--token/);
    });

    test("allows benign args (label selectors, etc.)", () => {
      expect(() =>
        assertNoDangerousFlags(undefined, [
          "-l",
          "app=foo",
          "--field-selector=status.phase=Running",
        ])
      ).not.toThrow();
    });

    test("non-flag positional args are not inspected", () => {
      // "server" as a positional resource name (e.g. `kubectl get server`)
      // must not match the --server flag denylist.
      expect(() => assertNoDangerousFlags(undefined, ["server"])).not.toThrow();
    });
  });

  describe("escape hatch", () => {
    test("ALLOW_KUBECTL_UNSAFE_FLAGS=true bypasses the check", () => {
      process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = "true";
      expect(() =>
        assertNoDangerousFlags(
          { server: "https://x", "insecure-skip-tls-verify": "true" },
          ["--token=t"]
        )
      ).not.toThrow();
    });

    test("other truthy-ish values do NOT bypass the check", () => {
      process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = "1";
      expect(() => assertNoDangerousFlags({ server: "x" })).toThrow(McpError);

      process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = "yes";
      expect(() => assertNoDangerousFlags({ server: "x" })).toThrow(McpError);
    });
  });
});

describe("kubectl_generic refuses dangerous flags before executing kubectl", () => {
  // Sentinel: if kubectl were invoked we would see a real kubectl error
  // ("Failed to execute kubectl command..."). We assert we instead get the
  // denylist error, proving the guard runs before execFileSync.
  const stubManager = {} as KubernetesManager;
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

  test("blocks the exact PoC payload (--server + --insecure-skip-tls-verify)", async () => {
    await expect(
      kubectlGeneric(stubManager, {
        command: "get",
        resourceType: "pods",
        flags: {
          server: "https://127.0.0.1:19001",
          "insecure-skip-tls-verify": "true",
        },
      })
    ).rejects.toThrow(/server/);
  });

  test("blocks dangerous flag smuggled through args", async () => {
    await expect(
      kubectlGeneric(stubManager, {
        command: "get",
        resourceType: "pods",
        args: ["--server=https://attacker.example.com"],
      })
    ).rejects.toThrow(/--server/);
  });

  test("error code is InvalidParams (not InternalError)", async () => {
    try {
      await kubectlGeneric(stubManager, {
        command: "get",
        flags: { token: "x" },
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(McpError);
      expect((e as McpError).code).toBe(ErrorCode.InvalidParams);
    }
  });
});
