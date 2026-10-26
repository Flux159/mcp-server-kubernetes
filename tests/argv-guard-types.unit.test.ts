import { expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  assertNoDangerousFlags,
  assertNoRemoteFileReads,
  assertSafeArgv,
} from "../src/security/kubectl-flags.js";
import { kubectlGeneric } from "../src/tools/kubectl-generic.js";
import { kubectlCreate } from "../src/tools/kubectl-create.js";

// The argv guards must fail closed on anything they cannot classify: a token
// that is not a string (child_process stringifies it, so the guard has to
// refuse rather than skip it), and output formats that read a file under a
// spelling the deny-list did not list.

const ENV = [
  "ENABLE_UNSAFE_SSE_TRANSPORT",
  "ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT",
  "ALLOW_KUBECTL_UNSAFE_FLAGS",
] as const;

// The guards run before any kubectl execution, so a stub manager is fine.
const manager = {} as any;

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

describe("non-string argv entries", () => {
  const smuggled: [string, unknown][] = [
    ["nested array", ["--server=https://attacker.example"]],
    ["object with toString", { toString: () => "--token=x" }],
    ["number", 5],
    ["null", null],
  ];

  for (const [label, tok] of smuggled) {
    test(`assertNoDangerousFlags rejects a ${label}`, () => {
      expect(() =>
        assertNoDangerousFlags({}, ["pods", tok] as any)
      ).toThrow(/non-string argument/);
    });

    test(`assertSafeArgv rejects a ${label}`, () => {
      expect(() => assertSafeArgv(["get", tok] as any)).toThrow(
        /non-string argument/
      );
    });
  }

  test("assertSafeArgv rejects non-strings even with the escape hatch set", () => {
    process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = "true";
    expect(() => assertSafeArgv(["get", ["pods"]] as any)).toThrow(
      /non-string argument/
    );
  });

  test("assertNoRemoteFileReads rejects non-strings on a remote transport", () => {
    process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "true";
    expect(() =>
      assertNoRemoteFileReads(["create", ["--from-file=/etc/passwd"]] as any)
    ).toThrow(/non-string argument/);
  });

  test("kubectl_generic refuses a nested array in args", async () => {
    await expect(
      kubectlGeneric(manager, {
        command: "get",
        resourceType: "pods",
        args: [["--server=https://attacker.example"]] as any,
      })
    ).rejects.toThrow(/non-string argument/);
  });

  test("kubectl_generic refuses a non-string positional", async () => {
    await expect(
      kubectlGeneric(manager, {
        command: "get",
        resourceType: ["--server=https://attacker.example"] as any,
      })
    ).rejects.toThrow(/non-string argument/);
  });
});

describe("file-reading output formats", () => {
  const rejected: [string, string[]][] = [
    ["templatefile alias", ["-o", "templatefile=/etc/passwd"]],
    ["templatefile attached", ["-otemplatefile=/etc/passwd"]],
    ["templatefile long", ["--output=templatefile=/etc/passwd"]],
    ["templatefile with --template", ["-o", "templatefile", "--template=/etc/passwd"]],
    ["future ...file alias", ["-o", "custom-columnsfile=/etc/passwd"]],
  ];

  for (const [label, argv] of rejected) {
    test(`rejects ${label}`, () => {
      expect(() =>
        assertSafeArgv(["create", "configmap", "x", ...argv])
      ).toThrow(/this output format takes a file path/);
    });
  }

  test("allows inline templates and ordinary formats", () => {
    for (const format of [
      "json",
      "yaml",
      "wide",
      "template={{.metadata.name}}",
      "go-template={{.metadata.name}}",
      "jsonpath={.spec.file}",
      "custom-columns=FILE:.spec.file",
    ]) {
      expect(() => assertSafeArgv(["get", "pods", "-o", format])).not.toThrow();
    }
  });

  test("kubectl_create refuses output templatefile=<path>", async () => {
    await expect(
      kubectlCreate(manager, {
        resourceType: "configmap",
        name: "x",
        dryRun: true,
        output: "templatefile=/etc/passwd",
      } as any)
      // kubectl_create may also refuse it itself, before building the argv.
    ).rejects.toThrow(/this output format takes a file path|Unsupported output format/);
  });

  test("kubectl_generic refuses outputFormat templatefile=<path>", async () => {
    await expect(
      kubectlGeneric(manager, {
        command: "create",
        subCommand: "configmap",
        name: "x",
        outputFormat: "templatefile=/etc/passwd",
        args: ["--dry-run=client"],
      })
    ).rejects.toThrow(/this output format takes a file path/);
  });
});
