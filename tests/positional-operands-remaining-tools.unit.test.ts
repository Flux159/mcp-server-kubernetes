import { expect, test, describe } from "vitest";
import { execInPod } from "../src/tools/exec_in_pod.js";
import { kubectlPatch } from "../src/tools/kubectl-patch.js";
import { kubectlRollout } from "../src/tools/kubectl-rollout.js";
import { kubectlLogs } from "../src/tools/kubectl-logs.js";
import { kubectlCreate } from "../src/tools/kubectl-create.js";
import { explainResource } from "../src/tools/kubectl-operations.js";
import { nodeManagement } from "../src/tools/node-management.js";
import { startPortForward } from "../src/tools/port_forward.js";

// The remaining tools that push caller values into positional argv slots.
// kubectl parses any "-"-prefixed token as a flag wherever it sits, so a value
// like "--filename=/path" in a name slot makes kubectl read that file from the
// server and echo it in a decode error. Every slot refuses a leading "-",
// matching kubectl_get / describe / delete / scale / generic.

// The guards run before any kubectl execution, so a stub manager is fine.
const manager = {} as any;

const INJECTED = "--filename=/root/.kube/config";
const REFUSED = /parsed as a command-line flag/;

describe("positional operands refuse a leading '-'", () => {
  test("exec_in_pod name", async () => {
    await expect(
      execInPod(manager, { name: INJECTED, command: ["true"] })
    ).rejects.toThrow(REFUSED);
  });

  test("kubectl_patch resourceType and name", async () => {
    await expect(
      kubectlPatch(manager, {
        resourceType: INJECTED,
        name: "--local",
        patchData: {},
      })
    ).rejects.toThrow(REFUSED);
    await expect(
      kubectlPatch(manager, {
        resourceType: "configmap",
        name: INJECTED,
        patchData: {},
      })
    ).rejects.toThrow(REFUSED);
  });

  test("kubectl_rollout subCommand, resourceType and name", async () => {
    const base = {
      subCommand: "status",
      resourceType: "deployment",
      name: "web",
      namespace: "default",
    };
    for (const field of ["subCommand", "resourceType", "name"] as const) {
      await expect(
        kubectlRollout(manager, { ...base, [field]: INJECTED } as any)
      ).rejects.toThrow(REFUSED);
    }
  });

  test("kubectl_logs name", async () => {
    await expect(
      kubectlLogs(manager, {
        resourceType: "pod",
        name: INJECTED,
        namespace: "default",
      })
    ).rejects.toThrow(REFUSED);
  });

  test("kubectl_create name, secretType and serviceType", async () => {
    await expect(
      kubectlCreate(manager, {
        resourceType: "configmap",
        name: INJECTED,
        dryRun: true,
      } as any)
    ).rejects.toThrow(REFUSED);
    await expect(
      kubectlCreate(manager, {
        resourceType: "secret",
        secretType: INJECTED,
        name: "x",
        dryRun: true,
      } as any)
    ).rejects.toThrow(REFUSED);
    await expect(
      kubectlCreate(manager, {
        resourceType: "service",
        serviceType: INJECTED,
        name: "x",
        dryRun: true,
      } as any)
    ).rejects.toThrow(REFUSED);
  });

  test("explain_resource resource", async () => {
    await expect(explainResource({ resource: INJECTED })).rejects.toThrow(
      REFUSED
    );
  });

  test("node_management nodeName", async () => {
    // node_management reports failures as text rather than throwing.
    const result = await nodeManagement({
      operation: "cordon",
      nodeName: INJECTED,
    });
    expect(result.content[0].text).toMatch(REFUSED);
  });

  test("port_forward resourceType", async () => {
    await expect(
      startPortForward(manager, {
        resourceType: INJECTED,
        resourceName: "x",
        localPort: 18080,
        targetPort: 80,
      })
    ).rejects.toThrow(REFUSED);
  });
});
