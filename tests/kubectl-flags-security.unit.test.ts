import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  assertNoDangerousFlags,
  assertSafeArgv,
  execFileSyncSafe,
} from "../src/security/kubectl-flags.js";
import { kubectlGeneric } from "../src/tools/kubectl-generic.js";
import { kubectlGet } from "../src/tools/kubectl-get.js";
import { startPortForward } from "../src/tools/port_forward.js";
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

    test("rejects attached short-flag form '-sURL' (no separator)", () => {
      // pflag parses "-shttp://attacker" as "--server http://attacker".
      expect(() =>
        assertNoDangerousFlags(undefined, ["-shttp://attacker.example.com"])
      ).toThrow(McpError);
    });

    test("rejects attached short-flag form '-s=URL'", () => {
      expect(() =>
        assertNoDangerousFlags(undefined, ["-s=https://attacker"])
      ).toThrow(McpError);
    });

    test("does not flag benign short flags with attached values (-oyaml)", () => {
      expect(() =>
        assertNoDangerousFlags(undefined, ["-oyaml"])
      ).not.toThrow();
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

    test("rejects short-flag clusters that hide -s ('-Ashttp://...')", () => {
      // pflag parses "-Ashttp://attacker" as "-A" (--all-namespaces, boolean)
      // followed by "-s http://attacker" (--server).
      expect(() =>
        assertNoDangerousFlags(undefined, ["-Ashttp://attacker.example.com"])
      ).toThrow(McpError);
      expect(() =>
        assertNoDangerousFlags(undefined, ["-Aws=https://attacker"])
      ).toThrow(McpError);
      // "-f" is --follow (boolean) for `kubectl logs`, so the cluster keeps
      // parsing and "-s" lands on --server.
      expect(() =>
        assertNoDangerousFlags(undefined, ["-fshttp://attacker.example.com"])
      ).toThrow(McpError);
    });

    test("rejects underscore spellings of dangerous long flags", () => {
      // kubectl's pflag normalizer treats "_" as "-", so these reach the same
      // flags as their kebab-case spellings.
      for (const tok of [
        "--insecure_skip_tls_verify=true",
        "--client_key=/tmp/k.pem",
        "--certificate_authority=/tmp/ca.pem",
        "--tls_server_name=attacker",
        "--as_group=system:masters",
        "--as_uid=0",
      ]) {
        expect(() => assertNoDangerousFlags(undefined, [tok])).toThrow(McpError);
      }
    });

    test("rejects underscore spellings in the flags object too", () => {
      expect(() =>
        assertNoDangerousFlags({ insecure_skip_tls_verify: "true" })
      ).toThrow(McpError);
    });

    test("does not flag benign boolean clusters or attached values", () => {
      expect(() =>
        assertNoDangerousFlags(undefined, [
          "-it", // exec: --stdin --tty
          "-A", // --all-namespaces
          "-ojsonpath={.items[*].metadata.name}", // 's' inside the value
          "-nkube-system",
          "-lapp=nginx",
          "-o=custom-columns=NAME:.metadata.name",
          "-v6",
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

  test("blocks attached short-flag form '-sURL' smuggled through args", async () => {
    await expect(
      kubectlGeneric(stubManager, {
        command: "get",
        resourceType: "pods",
        args: ["-shttp://attacker.example.com"],
      })
    ).rejects.toThrow(McpError);
  });

  test("blocks a short-flag cluster hiding -s in args", async () => {
    await expect(
      kubectlGeneric(stubManager, {
        command: "get",
        resourceType: "pods",
        args: ["-Ashttp://attacker.example.com"],
      })
    ).rejects.toThrow(McpError);
  });

  test("blocks underscore spelling of --insecure-skip-tls-verify", async () => {
    await expect(
      kubectlGeneric(stubManager, {
        command: "get",
        resourceType: "pods",
        flags: { insecure_skip_tls_verify: "true" },
      })
    ).rejects.toThrow(McpError);
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

describe("assertSafeArgv (full-argv guard for positional slots)", () => {
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

  test("rejects --server smuggled into a positional slot", () => {
    // Mirrors `kubectl get pods <name>` with name="--server=...".
    expect(() =>
      assertSafeArgv(["get", "pods", "--server=https://attacker", "-n", "default"])
    ).toThrow(/--server/);
  });

  test("rejects --kubeconfig / --token / -s anywhere in argv", () => {
    expect(() => assertSafeArgv(["get", "--kubeconfig=/tmp/evil"])).toThrow(
      /kubeconfig/
    );
    expect(() => assertSafeArgv(["get", "--token=stolen"])).toThrow(/--token/);
    expect(() => assertSafeArgv(["get", "-s", "https://attacker"])).toThrow(/-s/);
  });

  test("rejects attached short-flag form '-sURL' in argv", () => {
    expect(() =>
      assertSafeArgv(["get", "pods", "-shttp://attacker.example.com"])
    ).toThrow(McpError);
    expect(() =>
      assertSafeArgv(["get", "pods", "-s=https://attacker"])
    ).toThrow(McpError);
  });

  test("rejects short-flag clusters that hide -s in argv", () => {
    // "-A" is a boolean shorthand, so pflag keeps parsing the cluster and
    // reads the rest as "-s http://attacker" (--server).
    expect(() =>
      assertSafeArgv(["get", "pods", "-Ashttp://127.0.0.1:59999"])
    ).toThrow(McpError);
    expect(() =>
      assertSafeArgv(["get", "pods", "-Rws=https://attacker.example.com"])
    ).toThrow(McpError);
  });

  test("rejects underscore spellings of dangerous flags in argv", () => {
    expect(() =>
      assertSafeArgv(["get", "pods", "--insecure_skip_tls_verify=true"])
    ).toThrow(McpError);
    expect(() => assertSafeArgv(["get", "pods", "--as_group=system:masters"]))
      .toThrow(McpError);
    expect(() =>
      assertSafeArgv(["upgrade", "rel", "chart", "--kube_apiserver=https://x"])
    ).toThrow(McpError);
  });

  test("rejects the combined bypass payload from the report", () => {
    expect(() =>
      assertSafeArgv([
        "get",
        "pods",
        "-Ashttps://attacker.example.com",
        "--insecure_skip_tls_verify=true",
      ])
    ).toThrow(McpError);
  });

  test("rejects flags that write to attacker-chosen paths", () => {
    expect(() =>
      assertSafeArgv(["get", "pods", "--profile-output=/tmp/evil"])
    ).toThrow(/profile-output/);
    expect(() =>
      assertSafeArgv(["get", "pods", "--cache_dir=/tmp/evil"])
    ).toThrow(McpError);
  });

  test("allows benign short-flag clusters and attached values", () => {
    expect(() =>
      assertSafeArgv([
        "exec",
        "my-pod",
        "-it",
        "-cmy-sidecar",
        "-ojsonpath={.status.podIPs}",
        "-A",
      ])
    ).not.toThrow();
  });

  test("rejects helm credential/target flags (kube-* prefix)", () => {
    expect(() =>
      assertSafeArgv(["upgrade", "rel", "chart", "--kube-apiserver=https://x"])
    ).toThrow(/kube-apiserver/);
    expect(() =>
      assertSafeArgv(["install", "rel", "chart", "--kube-token=stolen"])
    ).toThrow(/kube-token/);
  });

  test("allows --context (every tool emits it; cannot redirect on its own)", () => {
    expect(() =>
      assertSafeArgv(["get", "pods", "--context", "prod", "-o", "json"])
    ).not.toThrow();
  });

  test("allows benign structural flags and positionals", () => {
    expect(() =>
      assertSafeArgv([
        "get",
        "pods",
        "my-pod",
        "-n",
        "default",
        "-l",
        "app=foo",
        "--field-selector=status.phase=Running",
        "-o",
        "json",
      ])
    ).not.toThrow();
  });

  test("ALLOW_KUBECTL_UNSAFE_FLAGS=true bypasses the argv guard", () => {
    process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = "true";
    expect(() =>
      assertSafeArgv(["get", "pods", "--server=https://attacker"])
    ).not.toThrow();
  });
});

describe("execFileSyncSafe wrapper", () => {
  const originalEnv = process.env.ALLOW_KUBECTL_UNSAFE_FLAGS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_KUBECTL_UNSAFE_FLAGS;
    } else {
      process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = originalEnv;
    }
  });

  test("throws before exec when argv carries a dangerous flag", () => {
    delete process.env.ALLOW_KUBECTL_UNSAFE_FLAGS;
    expect(() =>
      // "false" would exit non-zero if it ran; the guard must fire first.
      execFileSyncSafe("false", ["--server=https://attacker"], {
        encoding: "utf8",
      })
    ).toThrow(/--server/);
  });

  test("executes normally when argv is clean", () => {
    const out = execFileSyncSafe("printf", ["%s", "ok"], { encoding: "utf8" });
    expect(out).toBe("ok");
  });
});

describe("sibling tools refuse the positional flag-injection PoC", () => {
  // The 2026-05-22 fix only guarded kubectl_generic's flags/args. These tools
  // push user input (name, resourceType, ...) into bare positional argv slots,
  // so the report's `name: "--server=..."` payload reached kubectl. The shared
  // execFileSyncSafe wrapper must now block it before kubectl is invoked.
  const stubManager = {} as KubernetesManager;

  beforeEach(() => {
    delete process.env.ALLOW_KUBECTL_UNSAFE_FLAGS;
  });

  test("kubectl_get blocks name='--server=...' (exact report PoC)", async () => {
    await expect(
      kubectlGet(stubManager, {
        resourceType: "pods",
        name: "--server=https://127.0.0.1:19012",
        namespace: "default",
      })
    ).rejects.toThrow(/--server/);
  });

  test("kubectl_generic blocks name='--server=...' (positional bypass)", async () => {
    await expect(
      kubectlGeneric(stubManager, {
        command: "get",
        resourceType: "pods",
        name: "--server=https://attacker.example.com",
      })
    ).rejects.toThrow(/--server/);
  });

  // port_forward uses spawn (long-running process) instead of the shared
  // execFileSyncSafe wrapper, so it guards its own argv. resourceType is pushed
  // into a positional slot as `${resourceType}/${resourceName}`, so a payload
  // like resourceType="--server=..." would otherwise redirect kubectl.
  test("port_forward blocks resourceType='--server=...' before spawning", async () => {
    await expect(
      startPortForward(stubManager, {
        resourceType: "--server=https://127.0.0.1:19099",
        resourceName: "web",
        localPort: 8080,
        targetPort: 80,
        namespace: "default",
      })
    ).rejects.toThrow(/--server/);
  });

  test("port_forward rejection is an McpError with InvalidParams code", async () => {
    try {
      await startPortForward(stubManager, {
        resourceType: "--server=https://attacker",
        resourceName: "web",
        localPort: 8080,
        targetPort: 80,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(McpError);
      expect((e as McpError).code).toBe(ErrorCode.InvalidParams);
    }
  });
});
