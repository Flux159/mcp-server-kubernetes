import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListPromptsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { asResponseSchema } from "./context-helper";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("kubernetes prompts", () => {
  let transport: StdioClientTransport;
  let client: Client;

  beforeEach(async () => {
    try {
      transport = new StdioClientTransport({
        command: "bun",
        args: ["src/index.ts"],
        stderr: "pipe",
      });

      client = new Client(
        {
          name: "test-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );
      await client.connect(transport);
    } catch (e) {
      console.error("Error in beforeEach:", e);
      throw e;
    }
  });

  afterEach(async () => {
    try {
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  test("list available prompts", async () => {
    console.log("Listing available prompts...");
    const promptsList = await client.request(
      {
        method: "prompts/list",
      },
      ListPromptsResultSchema
    );
    expect(promptsList.prompts).toBeDefined();
    expect(promptsList.prompts.length).toBeGreaterThan(0);
    expect(promptsList.prompts).toContainEqual({
      name: "k8s-diagnose",
      description: "Diagnose Kubernetes Resources.",
      arguments: [
        {
          name: "keyword",
          description: "A keyword to search pod/node names.",
          required: true,
        },
        {
          name: "namespace",
          description: "Optional: Specify a namespace to narrow down the search.",
          required: false,
        },
      ],
    });
  });
}); 