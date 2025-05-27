import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SetCurrentContextResponseSchema } from "../src/models/response-schemas.js";

/**
 * Utility function to create a promise that resolves after specified milliseconds
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("kubernetes set current context operations", () => {
  let transport: StdioClientTransport;
  let client: Client;
  let originalContext: string;

  /**
   * Set up before each test:
   * - Creates a new StdioClientTransport instance
   * - Initializes and connects the MCP client
   * - Waits for connection to be established
   * - Stores the original context to restore it later
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

      // Get the current context to restore it later
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
        SetCurrentContextResponseSchema
      );

      const contextData = JSON.parse(result.content[0].text);
      originalContext = contextData.currentContext;
    } catch (e) {
      console.error("Error in beforeEach:", e);
      throw e;
    }
  });

  /**
   * Clean up after each test:
   * - Restore the original context
   * - Closes the transport
   * - Waits for cleanup to complete
   */
  afterEach(async () => {
    try {
      // Restore the original context
      if (originalContext) {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "set_current_context",
              arguments: {
                name: originalContext,
              },
            },
          },
          SetCurrentContextResponseSchema
        );
      }

      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  /**
   * Test case: Set current Kubernetes context
   * Verifies that the set_current_context tool changes the current context
   */
  test("set current context", async () => {
    // Get available contexts
    const contextsResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_contexts",
          arguments: {
            showCurrent: true,
          },
        },
      },
      SetCurrentContextResponseSchema
    );

    const contextsData = JSON.parse(contextsResult.content[0].text);

    // Find a context that is not the current one
    const otherContext = contextsData.contexts.find(
      (context: any) => !context.isCurrent
    );

    // Skip the test if there's only one context available
    if (!otherContext) {
      console.log("Skipping test: No alternative context available");
      return;
    }

    console.log(`Setting current context to: ${otherContext.name}`);

    // Set the current context to a different one
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "set_current_context",
          arguments: {
            name: otherContext.name,
          },
        },
      },
      SetCurrentContextResponseSchema
    );

    // Verify the response structure
    expect(result.content[0].type).toBe("text");

    // Parse the response text
    const responseData = JSON.parse(result.content[0].text);

    // Verify that the context was set successfully
    expect(responseData.success).toBe(true);
    expect(responseData.message).toContain(`Current context set to '${otherContext.name}'`);
    expect(responseData.context).toBe(otherContext.name);

    // Verify that the current context has actually changed
    const verifyResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "get_current_context",
          arguments: {
            detailed: false,
          },
        },
      },
      SetCurrentContextResponseSchema
    );

    const verifyData = JSON.parse(verifyResult.content[0].text);
    expect(verifyData.currentContext).toBe(otherContext.name);

    console.log("Context successfully changed and verified");
  });
});
