import { expect, test, describe, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

/**
 * Verifies that tool-restriction environment variables
 * (ALLOW_ONLY_READONLY_TOOLS, ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS, ALLOWED_TOOLS)
 * are enforced at the tools/call layer in addition to tools/list.
 *
 * A client that knows a tool name must not be able to invoke a restricted
 * tool directly by sending a tools/call request.
 */
describe("tool restriction enforcement (tools/call layer)", () => {
  let transport: StdioClientTransport | undefined;
  let client: Client | undefined;

  async function connectWithEnv(env: Record<string, string>): Promise<Client> {
    transport = new StdioClientTransport({
      command: "bun",
      args: ["src/index.ts"],
      env: {
        ...process.env,
        ...env,
      } as Record<string, string>,
      stderr: "pipe",
    });
    client = new Client(
      { name: "restriction-test-client", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
    return client;
  }

  afterEach(async () => {
    try {
      await client?.close();
    } catch {}
    try {
      await transport?.close();
    } catch {}
    client = undefined;
    transport = undefined;
  });

  test("ALLOW_ONLY_READONLY_TOOLS rejects a destructive tool at call-time", async () => {
    const c = await connectWithEnv({ ALLOW_ONLY_READONLY_TOOLS: "true" });

    const list = (await c.request(
      { method: "tools/list", params: {} },
      // @ts-ignore - minimal schema; we only inspect names
      z.any()
    )) as { tools: Array<{ name: string }> };
    const names = list.tools.map((t) => t.name);
    expect(names).not.toContain("kubectl_delete");

    await expect(
      c.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: { resourceType: "pod", name: "anything" },
          },
        },
        // @ts-ignore - minimal schema
        z.any()
      )
    ).rejects.toThrow(/not allowed/i);
  }, 30000);

  test("ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS rejects a destructive tool at call-time", async () => {
    const c = await connectWithEnv({
      ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS: "true",
    });

    await expect(
      c.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: { resourceType: "pod", name: "anything" },
          },
        },
        // @ts-ignore - minimal schema
        z.any()
      )
    ).rejects.toThrow(/not allowed/i);
  }, 30000);

  test("ALLOWED_TOOLS allowlist rejects unlisted tools at call-time", async () => {
    const c = await connectWithEnv({ ALLOWED_TOOLS: "kubectl_get,ping" });

    await expect(
      c.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: { resourceType: "pod", name: "anything" },
          },
        },
        // @ts-ignore - minimal schema
        z.any()
      )
    ).rejects.toThrow(/not allowed/i);
  }, 30000);
});
