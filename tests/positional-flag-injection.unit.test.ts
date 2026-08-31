import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { assertSafeArgv } from "../src/security/kubectl-flags.js";
import { kubectlGet } from "../src/tools/kubectl-get.js";
import { kubectlDescribe } from "../src/tools/kubectl-describe.js";
import { kubectlDelete } from "../src/tools/kubectl-delete.js";
import { kubectlScale } from "../src/tools/kubectl-scale.js";
import { kubectlGeneric } from "../src/tools/kubectl-generic.js";

// kubectl's pflag parser treats any "-"-prefixed token as a flag wherever it
// sits, so a resource type or name pushed into a bare positional slot is a flag
// injection point. assertSafeArgv is a denylist and can only refuse the flags
// it knows about, so narrowing it flag-by-flag will always lag.
//
// Two layers close that: the operand slots refuse a leading "-" outright
// (a resource type or name is never legitimately flag-shaped), and the
// file-reading output formats are refused anywhere in the argv, on every
// transport, since no tool ever emits one.

// The guards run before any kubectl execution, so a stub manager is fine.
const manager = {} as any;

const INJECTED = "-o=go-template-file=/root/.kube/config";

describe("assertSafeArgv rejects file-reading output formats", () => {
  // These are refused on every transport: no tool ever legitimately emits one,
  // and they are reachable through positional slots that exist in read-only
  // tools too.
  const rejected: [string, string[]][] = [
    ["-o= form", ["-o=go-template-file=/etc/passwd"]],
    ["-o attached", ["-ogo-template-file=/etc/passwd"]],
    ["-o split", ["-o", "go-template-file=/etc/passwd"]],
    ["clustered", ["-Aogo-template-file=/etc/passwd"]],
    ["--output=", ["--output=go-template-file=/etc/passwd"]],
    ["--output split", ["--output", "jsonpath-file=/etc/passwd"]],
    ["custom-columns-file", ["-o=custom-columns-file=/etc/passwd"]],
  ];

  for (const [label, argv] of rejected) {
    test(`rejects ${label}`, () => {
      expect(() => assertSafeArgv(["get", "configmaps", ...argv])).toThrow(
        /this output format takes a file path/
      );
    });
  }

  test("leaves the inline (non-file) formats alone", () => {
    expect(() =>
      assertSafeArgv(["get", "pods", "-o", "go-template={{.metadata.name}}"])
    ).not.toThrow();
    expect(() =>
      assertSafeArgv(["get", "pods", "-o=jsonpath={.items[0].metadata.name}"])
    ).not.toThrow();
    expect(() =>
      assertSafeArgv(["get", "pods", "-o=custom-columns=NAME:.metadata.name"])
    ).not.toThrow();
    expect(() => assertSafeArgv(["get", "pods", "-o", "json"])).not.toThrow();
  });
});

describe("tools refuse flag-shaped positional operands", () => {
  // The read primitive needs no cluster and no remote transport, so these are
  // asserted under plain stdio.
  const TRANSPORT_ENV = [
    "ENABLE_UNSAFE_SSE_TRANSPORT",
    "ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT",
  ] as const;
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

  const flagLike = /does not begin with "-"/;

  test("kubectl_get rejects a flag-shaped name", async () => {
    // An `output` outside the documented set emits no trailing -o of its own,
    // which is what makes the operand slot worth guarding directly.
    await expect(
      kubectlGet(manager, {
        resourceType: "configmaps",
        name: INJECTED,
        output: "raw",
      })
    ).rejects.toThrow(flagLike);
  });

  test("kubectl_get rejects a flag-shaped resourceType", async () => {
    await expect(
      kubectlGet(manager, { resourceType: INJECTED, output: "raw" })
    ).rejects.toThrow(flagLike);
  });

  test("kubectl_describe rejects a flag-shaped name", async () => {
    await expect(
      kubectlDescribe(manager, { resourceType: "configmaps", name: INJECTED })
    ).rejects.toThrow(flagLike);
  });

  test("kubectl_delete rejects a flag-shaped name", async () => {
    await expect(
      kubectlDelete(manager, { resourceType: "configmaps", name: INJECTED })
    ).rejects.toThrow(flagLike);
  });

  test("kubectl_scale rejects a flag-shaped name", async () => {
    // kubectl_scale reports errors in its result payload rather than throwing.
    const result: any = await kubectlScale(manager, {
      name: INJECTED,
      replicas: 1,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(false);
    expect(payload.message).toMatch(flagLike);
  });

  test("kubectl_generic rejects a flag-shaped resourceType", async () => {
    await expect(
      kubectlGeneric(manager, { command: "get", resourceType: INJECTED })
    ).rejects.toThrow(flagLike);
  });

  test("kubectl_generic rejects a flag-shaped command", async () => {
    await expect(
      kubectlGeneric(manager, { command: INJECTED })
    ).rejects.toThrow(flagLike);
  });

  test("kubectl_generic still allows flags in the args array", () => {
    // `args` is the free-form slot; narrowing the operand slots must not
    // narrow it. This one only has to survive the guards, so assert on the
    // argv checker rather than executing kubectl.
    expect(() =>
      assertSafeArgv(["get", "pods", "--show-labels", "-o", "wide"])
    ).not.toThrow();
  });
});
