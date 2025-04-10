import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListContextsResponseSchema } from "../src/models/response-schemas.js";

/**
 * Utility function to create a promise that resolves after specified milliseconds
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("kubernetes contexts operations", () => {
  let transport: StdioClientTransport;
  let client: Client;

  /**
   * Set up before each test:
   * - Creates a new StdioClientTransport instance
   * - Initializes and connects the MCP client
   * - Waits for connection to be established
   */
  beforeEach(async () => {
    try {
      transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
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
      // Wait for connection to be fully established
      await sleep(1000);
    } catch (e) {
      console.error("Error in beforeEach:", e);
      throw e;
    }
  });

  /**
   * Clean up after each test:
   * - Closes the transport
   * - Waits for cleanup to complete
   */
  afterEach(async () => {
    try {
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  /**
   * Test case: List Kubernetes contexts
   * Verifies that the list_contexts tool returns a valid response with context information
   */
  test("list contexts", async () => {
    console.log("Listing Kubernetes contexts...");
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_contexts",
          arguments: {
            showCurrent: true,
          },
        },
      },
      ListContextsResponseSchema
    );

    // Verify the response structure
    expect(result.content[0].type).toBe("text");

    // Parse the response text
    const contextsData = JSON.parse(result.content[0].text);

    // Verify that the contexts array exists
    expect(contextsData.contexts).toBeDefined();
    expect(Array.isArray(contextsData.contexts)).toBe(true);

    // Verify that each context has the required properties
    if (contextsData.contexts.length > 0) {
      const firstContext = contextsData.contexts[0];
      expect(firstContext.name).toBeDefined();
      expect(firstContext.cluster).toBeDefined();
      expect(firstContext.user).toBeDefined();
      expect(typeof firstContext.isCurrent).toBe("boolean");
    }

    // Log the contexts for debugging
    console.log("Contexts:", JSON.stringify(contextsData, null, 2));
  });
});
