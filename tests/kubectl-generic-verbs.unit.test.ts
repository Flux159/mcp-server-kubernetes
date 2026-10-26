import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { assertAllowedGenericCommand } from "../src/security/kubectl-flags.js";
import { kubectlGeneric } from "../src/tools/kubectl-generic.js";

// kubectl_generic's verb policy. The flag guards only see dash-prefixed
// tokens; these verbs reach the operator's credentials or the server's
// filesystem through plain operands, so they are matched on the verb.

const ENV = [
  "ENABLE_UNSAFE_SSE_TRANSPORT",
  "ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT",
  "ALLOW_KUBECTL_UNSAFE_FLAGS",
] as const;

// The guard runs before any kubectl execution, so a stub manager is fine.
const manager = {} as any;

describe("assertAllowedGenericCommand", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    ENV.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    ENV.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  describe("on every transport", () => {
    const denied: [string, string[]][] = [
      ["config view --raw", ["config", "view", "--raw", "--flatten"]],
      [
        "config set",
        ["config", "set", "clusters.prod.server", "https://attacker.example"],
      ],
      ["config unset", ["config", "unset", "clusters.prod.certificate-authority"]],
      ["proxy", ["proxy", "--address=0.0.0.0", "--accept-hosts=.*"]],
      ["port-forward", ["port-forward", "pod/x", "8080:80"]],
      ["attach", ["attach", "pod/x"]],
      ["edit", ["edit", "deployment/x"]],
    ];

    for (const [label, argv] of denied) {
      test(`rejects ${label}`, () => {
        expect(() => assertAllowedGenericCommand(argv)).toThrow(
          /through kubectl_generic/
        );
      });
    }

    test("rejects a command that is not a verb name", () => {
      // kubectl skips an empty first argument and takes the next token as
      // the verb: kubectl "" config view == kubectl config view.
      for (const verb of ["", " config", "config view", "-v"]) {
        expect(() =>
          assertAllowedGenericCommand([verb, "config", "view"])
        ).toThrow(/must be a kubectl subcommand name/);
      }
    });

    test("allows ordinary verbs", () => {
      for (const argv of [
        ["get", "pods", "-n", "default"],
        ["rollout", "history", "deployment/x"],
        ["top", "pods"],
        ["auth", "can-i", "list", "pods"],
        // Not a config command: the verb is "get".
        ["get", "configmaps", "config"],
      ]) {
        expect(() => assertAllowedGenericCommand(argv)).not.toThrow();
      }
    });

    test("ALLOW_KUBECTL_UNSAFE_FLAGS lifts the credential/long-running denials", () => {
      process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = "true";
      expect(() =>
        assertAllowedGenericCommand(["config", "view", "--raw"])
      ).not.toThrow();
      expect(() => assertAllowedGenericCommand(["proxy"])).not.toThrow();
    });
  });

  describe("cp under stdio", () => {
    test("allows copying a local file into a pod", () => {
      expect(() =>
        assertAllowedGenericCommand(["cp", "/home/me/app.conf", "ns/pod:/tmp/app.conf"])
      ).not.toThrow();
      expect(() =>
        assertAllowedGenericCommand([
          "cp",
          "./data",
          "pod:/data",
          "--container=main",
        ])
      ).not.toThrow();
    });

    const rejected: [string, string[]][] = [
      ["local destination", ["cp", "ns/pod:/tmp/payload", "/home/me/.bashrc"]],
      ["relative destination", ["cp", "pod:/tmp/payload", "kubeconfig"]],
      [
        "destination hidden behind a split flag value",
        ["cp", "pod:/tmp/payload", "/home/me/.bashrc", "-c", "a:b"],
      ],
      [
        "dash-prefixed destination after --",
        ["cp", "pod:/tmp/payload", "--", "-rc"],
      ],
    ];

    for (const [label, argv] of rejected) {
      test(`rejects ${label}`, () => {
        expect(() => assertAllowedGenericCommand(argv)).toThrow(
          /written to the MCP server's own filesystem/
        );
      });
    }
  });

  describe("under a remote transport", () => {
    beforeEach(() => {
      process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "true";
    });

    test("rejects cp in either direction", () => {
      for (const argv of [
        ["cp", "/etc/passwd", "ns/pod:/tmp/x"],
        ["cp", "ns/pod:/tmp/x", "/home/server/.kube/config"],
      ]) {
        expect(() => assertAllowedGenericCommand(argv)).toThrow(
          /disabled on remote/
        );
      }
    });

    test("rejects kustomize with a server-side directory", () => {
      expect(() => assertAllowedGenericCommand(["kustomize", "/etc"])).toThrow(
        /disabled on remote/
      );
    });

    test("ALLOW_KUBECTL_UNSAFE_FLAGS does not lift the remote denials", () => {
      process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = "true";
      expect(() =>
        assertAllowedGenericCommand(["cp", "/etc/passwd", "pod:/tmp/x"])
      ).toThrow(/disabled on remote/);
    });
  });

  describe("kubectl_generic integration", () => {
    test("refuses config view --raw from the flags object", async () => {
      await expect(
        kubectlGeneric(manager, {
          command: "config",
          subCommand: "view",
          flags: { raw: true, flatten: true, output: "json" },
        })
      ).rejects.toThrow(/through kubectl_generic/);
    });

    test("refuses an empty command", async () => {
      await expect(
        kubectlGeneric(manager, {
          command: "",
          subCommand: "config",
          resourceType: "view",
        })
      ).rejects.toThrow(/must be a kubectl subcommand name/);
    });

    test("refuses cp on a remote transport", async () => {
      process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "true";
      await expect(
        kubectlGeneric(manager, {
          command: "cp",
          args: ["/etc/passwd", "default/receiver:/tmp/x"],
        })
      ).rejects.toThrow(/disabled on remote/);
    });
  });
});
