import { expect, test, describe } from "vitest";
import { parseAllowedTools } from "../src/index";

/**
 * Verifies how an ALLOWED_TOOLS value is parsed, in particular the
 * "read-only+<tools>" form that adds named tools on top of the read-only set
 * instead of replacing it.
 */
describe("ALLOWED_TOOLS parsing", () => {
  test("returns null when unset or empty", () => {
    expect(parseAllowedTools(undefined)).toBeNull();
    expect(parseAllowedTools("")).toBeNull();
  });

  test("a plain list names the tools exhaustively", () => {
    const parsed = parseAllowedTools("kubectl_get,ping");

    expect(parsed?.withReadonlyBaseline).toBe(false);
    expect([...(parsed?.names ?? [])].sort()).toEqual(["kubectl_get", "ping"]);
  });

  test("the read-only+ prefix keeps the read-only baseline", () => {
    const parsed = parseAllowedTools("read-only+kubectl_scale,kubectl_apply");

    expect(parsed?.withReadonlyBaseline).toBe(true);
    expect([...(parsed?.names ?? [])].sort()).toEqual([
      "kubectl_apply",
      "kubectl_scale",
    ]);
  });

  test("the prefix is accepted as readonly+ and case-insensitively", () => {
    expect(parseAllowedTools("readonly+kubectl_scale")).toEqual({
      names: new Set(["kubectl_scale"]),
      withReadonlyBaseline: true,
    });
    expect(parseAllowedTools("Read-Only+kubectl_scale")).toEqual({
      names: new Set(["kubectl_scale"]),
      withReadonlyBaseline: true,
    });
  });

  test("surrounding whitespace is ignored", () => {
    const parsed = parseAllowedTools("  read-only+ kubectl_scale , ping  ");

    expect(parsed?.withReadonlyBaseline).toBe(true);
    expect([...(parsed?.names ?? [])].sort()).toEqual(["kubectl_scale", "ping"]);
  });

  test("the prefix alone is the read-only set with nothing added", () => {
    const parsed = parseAllowedTools("read-only+");

    expect(parsed?.withReadonlyBaseline).toBe(true);
    expect([...(parsed?.names ?? [])]).toEqual([]);
  });

  test("the prefix counts only at the start of the value", () => {
    const parsed = parseAllowedTools("kubectl_get,read-only+ping");

    expect(parsed?.withReadonlyBaseline).toBe(false);
    expect([...(parsed?.names ?? [])].sort()).toEqual([
      "kubectl_get",
      "read-only+ping",
    ]);
  });
});
