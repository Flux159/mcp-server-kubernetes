import { expect, test, describe } from "vitest";
import {
  buildDefaultAllowedHosts,
  isAllInterfacesHost,
} from "../src/utils/allowed-hosts.js";

describe("isAllInterfacesHost", () => {
  test("recognises the all-interfaces bind addresses", () => {
    expect(isAllInterfacesHost("0.0.0.0")).toBe(true);
    expect(isAllInterfacesHost("::")).toBe(true);
    expect(isAllInterfacesHost("[::]")).toBe(true);
    expect(isAllInterfacesHost("::0")).toBe(true);
  });

  test("does not treat real addresses or hostnames as all-interfaces", () => {
    expect(isAllInterfacesHost("localhost")).toBe(false);
    expect(isAllInterfacesHost("127.0.0.1")).toBe(false);
    expect(isAllInterfacesHost("10.0.0.5")).toBe(false);
    expect(isAllInterfacesHost("mcp.svc.cluster.local")).toBe(false);
    // Not a wildcard bind: an address that merely starts with a zero octet.
    expect(isAllInterfacesHost("0.0.0.1")).toBe(false);
  });
});

describe("buildDefaultAllowedHosts", () => {
  test("always covers the localhost aliases with and without port", () => {
    const hosts = buildDefaultAllowedHosts("localhost", 3000);
    for (const expected of [
      "localhost",
      "localhost:3000",
      "127.0.0.1",
      "127.0.0.1:3000",
      "::1",
      "[::1]",
      "[::1]:3000",
    ]) {
      expect(hosts).toContain(expected);
    }
  });

  test("includes a specific configured host, which names a real interface", () => {
    const hosts = buildDefaultAllowedHosts("10.0.0.5", 3000);
    expect(hosts).toContain("10.0.0.5");
    expect(hosts).toContain("10.0.0.5:3000");
  });

  test("excludes all-interfaces binds: they are not a client-presentable name", () => {
    // "Host: 0.0.0.0:3000" is public knowledge, not a property of the
    // deployment, so accepting it would let any caller satisfy the allowlist.
    const v4 = buildDefaultAllowedHosts("0.0.0.0", 3000);
    expect(v4).not.toContain("0.0.0.0");
    expect(v4).not.toContain("0.0.0.0:3000");

    const v6 = buildDefaultAllowedHosts("::", 3000);
    expect(v6).not.toContain("::");
    expect(v6).not.toContain("[::]");
    expect(v6).not.toContain("[::]:3000");
  });

  test("localhost access still works when bound to all interfaces", () => {
    // kubectl port-forward / local curl send a localhost Host header, so those
    // workflows are unaffected by the exclusion above.
    const hosts = buildDefaultAllowedHosts("0.0.0.0", 3000);
    expect(hosts).toContain("localhost:3000");
    expect(hosts).toContain("127.0.0.1:3000");
  });
});
