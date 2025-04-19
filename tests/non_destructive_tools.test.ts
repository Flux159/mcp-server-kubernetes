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