import { expect, test, describe } from "vitest";
import { allTools, findUnknownToolNames } from "../src/index";

/**
 * Verifies that an ALLOWED_TOOLS allowlist is validated against the tools the
 * server actually provides, so a typo cannot silently narrow the tool surface.
 */
describe("ALLOWED_TOOLS name validation", () => {
  const knownToolNames = allTools.map((tool) => tool.name);

  test("accepts names that match existing tools", () => {
    expect(
      findUnknownToolNames(["kubectl_get", "kubectl_describe"], knownToolNames)
    ).toEqual([]);
  });

  test("reports a misspelled name", () => {
    expect(
      findUnknownToolNames(["kubectl_get", "kubectl_gett"], knownToolNames)
    ).toEqual(["kubectl_gett"]);
  });

  test("reports every unknown name, sorted", () => {
    expect(
      findUnknownToolNames(
        ["kubectl_delete", "zzz_unknown", "aaa_unknown"],
        knownToolNames
      )
    ).toEqual(["aaa_unknown", "zzz_unknown"]);
  });

  test("accepts an allowlist naming every tool", () => {
    expect(findUnknownToolNames(knownToolNames, knownToolNames)).toEqual([]);
  });

  test("accepts an empty allowlist", () => {
    expect(findUnknownToolNames([], knownToolNames)).toEqual([]);
  });
});
