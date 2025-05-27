import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GetCurrentContextResponseSchema } from "../src/models/response-schemas.js";

/**
 * Utility function to create a promise that resolves after specified milliseconds
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("kubernetes current context operations", () => {
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
   * Test case: Get current Kubernetes context
   * Verifies that the get_current_context tool returns the current context information
   */
  test("get current context", async () => {
    console.log("Getting current Kubernetes context...");
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_current_context",
          arguments: {
            detailed: false,
          },
        },
      },
      GetCurrentContextResponseSchema
    );

    // Verify the response structure
    expect(result.content[0].type).toBe("text");

    // Parse the response text
    const contextData = JSON.parse(result.content[0].text);

    // Verify that the current context is returned
    expect(contextData.currentContext).toBeDefined();
    expect(typeof contextData.currentContext).toBe("string");

    // Log the current context for debugging
    console.log("Current context:", contextData.currentContext);
  });

  /**
   * Test case: Get detailed current Kubernetes context
   * Verifies that the get_current_context tool returns detailed information when requested
   */
  test("get detailed current context", async () => {
    console.log("Getting detailed current Kubernetes context...");
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_current_context",
          arguments: {
            detailed: true,
          },
        },
      },
      GetCurrentContextResponseSchema
    );

    // Verify the response structure
    expect(result.content[0].type).toBe("text");

    // Parse the response text
    const contextData = JSON.parse(result.content[0].text);

    // Verify that the detailed context information is returned
    expect(contextData.name).toBeDefined();
    expect(contextData.cluster).toBeDefined();
    expect(contextData.user).toBeDefined();
    expect(contextData.namespace).toBeDefined();

    // Log the detailed context for debugging
    console.log("Detailed context:", JSON.stringify(contextData, null, 2));
  });
});
