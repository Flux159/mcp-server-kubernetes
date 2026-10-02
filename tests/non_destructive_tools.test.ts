// Import required test frameworks and SDK components
import { expect, test, describe } from "vitest";
// Import allTools and destructiveTools dynamically from index.ts
import { allTools, destructiveTools } from "../src/index";

/**
 * Test suite for ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS flag
 * Tests the behavior of the server when the flag is enabled vs. disabled
 */
describe("ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS flag", () => {
  test("should filter out destructive tools when ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS is true", () => {
    const originalEnv = process.env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS;
    process.env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS = "true";

    const nonDestructiveTools = true;

    // Filter out destructive tools
    const tools = nonDestructiveTools
      ? allTools.filter(
          (tool) => !destructiveTools.some((dt) => dt.name === tool.name)
        )
      : allTools;

    const toolNames = tools.map((tool) => tool.name);
    for (const destructiveTool of destructiveTools) {
      expect(toolNames).not.toContain(destructiveTool.name);
    }

    const nonDestructiveToolNames = allTools
      .filter(
        (tool) => !destructiveTools.some((dt) => dt.name === tool.name)
      )
      .map((tool) => tool.name);

    for (const nonDestructiveTool of nonDestructiveToolNames) {
      expect(toolNames).toContain(nonDestructiveTool);
    }

    process.env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS = originalEnv;
  });

  test("should include all tools when ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS is false", () => {
    const originalEnv = process.env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS;
    process.env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS = "false";

    const nonDestructiveTools = false;

    // When the flag is disabled, all tools should be available
    const tools = nonDestructiveTools
      ? allTools.filter(
          (tool) => !destructiveTools.some((dt) => dt.name === tool.name)
        )
      : allTools;

    const toolNames = tools.map((tool) => tool.name);
    for (const destructiveTool of destructiveTools) {
      expect(toolNames).toContain(destructiveTool.name);
    }

    const nonDestructiveToolNames = allTools
      .filter(
        (tool) => !destructiveTools.some((dt) => dt.name === tool.name)
      )
      .map((tool) => tool.name);

    for (const nonDestructiveTool of nonDestructiveToolNames) {
      expect(toolNames).toContain(nonDestructiveTool);
    }

    process.env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS = originalEnv;
  });
});
describe("ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS exec_in_pod", () => {
  test("exec_in_pod is classified as destructive", () => {
    expect(destructiveTools.map((t) => t.name)).toContain("exec_in_pod");
  });

  test("destructive tools that remain allowed are an explicit, documented list", () => {
    // README "Commands Available in Non-Destructive Mode" documents these as
    // creation/update operations. Any new destructiveHint tool not listed here
    // must either be added to destructiveTools or to this list deliberately.
    const documentedMutating = new Set([
      "kubectl_apply",
      "kubectl_scale",
      "kubectl_patch",
      "kubectl_rollout",
      "install_helm_chart",
      "upgrade_helm_chart",
    ]);
    const blocked = new Set(destructiveTools.map((t) => t.name));
    const unclassified = allTools
      .filter((t: any) => t.annotations?.destructiveHint === true)
      .map((t) => t.name)
      .filter((n) => !blocked.has(n) && !documentedMutating.has(n));
    expect(unclassified).toEqual([]);
  });
});
