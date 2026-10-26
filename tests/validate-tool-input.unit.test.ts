import { expect, test, describe } from "vitest";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { validateToolInput } from "../src/utils/validate-tool-input.js";
import { kubectlGetSchema } from "../src/tools/kubectl-get.js";
import { kubectlGenericSchema } from "../src/tools/kubectl-generic.js";
import { kubectlCreateSchema } from "../src/tools/kubectl-create.js";
import { kubectlLogsSchema } from "../src/tools/kubectl-logs.js";
import { kubectlPatchSchema } from "../src/tools/kubectl-patch.js";
import { kubectlScaleSchema } from "../src/tools/kubectl-scale.js";
import { execInPodSchema } from "../src/tools/exec_in_pod.js";

// Tool arguments are checked against each tool's inputSchema before the
// handler runs. The callers are mostly LLMs, so the error must say exactly
// which argument is wrong, what was expected and what was received.

function errorFor(tool: any, input: unknown): string {
  try {
    validateToolInput(tool, input);
  } catch (e) {
    expect(e).toBeInstanceOf(McpError);
    expect((e as McpError).code).toBe(ErrorCode.InvalidParams);
    return (e as McpError).message;
  }
  throw new Error("expected validation to fail");
}

describe("validateToolInput", () => {
  test("passes valid arguments through unchanged", () => {
    const input = {
      resourceType: "pods",
      namespace: "kube-system",
      output: "json",
      allNamespaces: false,
    };
    expect(validateToolInput(kubectlGetSchema, input)).toEqual(input);
  });

  test("keeps unknown arguments (the handlers ignore them)", () => {
    expect(
      validateToolInput(kubectlGetSchema, { resourceType: "pods", extra: 1 })
    ).toEqual({ resourceType: "pods", extra: 1 });
  });

  test("treats missing arguments as an empty object", () => {
    expect(validateToolInput({ name: "ping", inputSchema: { type: "object", properties: {} } }, undefined)).toEqual({});
  });

  test("rejects a non-object arguments value", () => {
    expect(errorFor(kubectlGetSchema, ["pods"])).toMatch(
      /the arguments must be a JSON object; got an array/
    );
  });

  describe("required arguments", () => {
    test("reports a missing argument with its type and description", () => {
      const message = errorFor(kubectlGetSchema, {});
      expect(message).toContain('Invalid arguments for tool "kubectl_get"');
      expect(message).toMatch(/missing required argument "resourceType" \(string\): /);
      expect(message).toContain("Correct these arguments and call kubectl_get again.");
    });

    test("treats null as missing", () => {
      expect(errorFor(kubectlGetSchema, { resourceType: null })).toMatch(
        /missing required argument "resourceType"/
      );
    });

    test("fills a missing required argument that has a default", () => {
      // kubectl_logs lists namespace as required but defaults it to "default".
      expect(
        validateToolInput(kubectlLogsSchema, { resourceType: "pod", name: "web" })
      ).toMatchObject({ namespace: "default" });
    });
  });

  describe("types", () => {
    test("names the argument, the expected type and the value received", () => {
      expect(
        errorFor(kubectlGenericSchema, {
          command: "get",
          args: ["pods", ["--server=https://attacker.example"]],
        })
      ).toContain(
        '"args[1]" must be a string; got an array (["--server=https://attacker.example"]).'
      );
    });

    test("suggests unquoting a quoted number or boolean", () => {
      const message = errorFor(kubectlScaleSchema, {
        name: "web",
        replicas: "3",
        context: true,
      });
      expect(message).toContain(
        '"replicas" must be a number; got a string ("3"). Pass the number without quotes: 3.'
      );
      expect(message).toContain('"context" must be a string; got a boolean (true).');
    });

    test("suggests passing JSON-encoded structures as values", () => {
      expect(
        errorFor(execInPodSchema, { name: "web", command: '["ls","-la"]' })
      ).toContain("Pass the JSON value itself, not a string containing it.");
    });

    test("reports every problem at once", () => {
      const message = errorFor(kubectlScaleSchema, { replicas: "x" });
      expect(message).toContain('missing required argument "name"');
      expect(message).toContain('"replicas" must be a number');
    });

    test("validates nested array items and objects", () => {
      const message = errorFor(kubectlCreateSchema, {
        resourceType: "configmap",
        name: "x",
        fromFileContent: [{ key: "a.conf", content: "x" }, { key: 5 }],
      });
      expect(message).toContain('"fromFileContent[1].key" must be a string');
      expect(message).toContain('missing required argument "fromFileContent[1].content"');
    });

    test("drops optional arguments passed as null", () => {
      expect(
        validateToolInput(kubectlGetSchema, { resourceType: "pods", name: null })
      ).toEqual({ resourceType: "pods" });
    });

    test("accepts either type when a schema lists several", () => {
      for (const patchData of [{ data: { a: "b" } }, [{ op: "remove", path: "/x" }]]) {
        expect(() =>
          validateToolInput(kubectlPatchSchema, {
            resourceType: "configmap",
            name: "x",
            patchData,
          })
        ).not.toThrow();
      }
      expect(
        errorFor(kubectlPatchSchema, {
          resourceType: "configmap",
          name: "x",
          patchData: "{}",
        })
      ).toContain('"patchData" must be an object or an array');
    });
  });

  describe("enums", () => {
    test("lists the allowed values", () => {
      expect(
        errorFor(kubectlGetSchema, { resourceType: "pods", output: "raw" })
      ).toContain(
        '"output" must be one of "json", "yaml", "wide", "name", "custom"; got a string ("raw").'
      );
    });

    test("normalises a value that differs only in case", () => {
      expect(
        validateToolInput(kubectlLogsSchema, {
          resourceType: "Pod",
          name: "web",
          namespace: "default",
        })
      ).toMatchObject({ resourceType: "pod" });
    });

  });
});
