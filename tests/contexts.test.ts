import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListContextsResponseSchema,
  GetCurrentContextResponseSchema,
  SetCurrentContextResponseSchema,
} from "../src/models/response-schemas";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";

/**
 * Utility function to create a promise that resolves after specified milliseconds
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("kubernetes contexts operations", () => {
  let transport: StdioClientTransport;
  let client: Client;
  let originalContext: string;
  let k8sManager: KubernetesManager;

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

      // Initialize Kubernetes manager for direct API access if needed
      k8sManager = new KubernetesManager();

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
        GetCurrentContextResponseSchema
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
   * - Restore the original context if it was changed
   * - Closes the transport
   * - Waits for cleanup to complete
   */
  afterEach(async () => {
    try {
      // Restore the original context if it was changed
      if (originalContext) {
        const currentResult = await client.request(
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

        const currentData = JSON.parse(currentResult.content[0].text);
        // if (currentData.currentContext !== originalContext) {
        //   await client.request(
        //     {
        //       method: "tools/call",
        //       params: {
        //         name: "set_current_context",
        //         arguments: {
        //           name: originalContext,
        //         },
        //       },
        //     },
        //     SetCurrentContextResponseSchema
        //   );
        //   console.log(`Restored original context: ${originalContext}`);
        // }
      }

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

    // Verify that exactly one context is marked as current
    const currentContexts = contextsData.contexts.filter(
      (context: any) => context.isCurrent
    );
    expect(currentContexts.length).toBe(1);

    // Log the contexts for debugging
    console.log("Contexts:", JSON.stringify(contextsData, null, 2));
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

    // Verify that the current context matches what we get from the KubeConfig directly
    const kubeConfig = k8sManager.getKubeConfig();
    const directCurrentContext = kubeConfig.getCurrentContext();
    expect(contextData.currentContext).toBe(directCurrentContext);

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

    // Verify that the context name matches what we get from the KubeConfig directly
    const kubeConfig = k8sManager.getKubeConfig();
    const directCurrentContext = kubeConfig.getCurrentContext();
    expect(contextData.name).toBe(directCurrentContext);

    // Log the detailed context for debugging
    console.log("Detailed context:", JSON.stringify(contextData, null, 2));
  });

  // Disabling because its interfering with other tests that are using context

  /**
   * Test case: Set current Kubernetes context
   * Verifies that the set_current_context tool changes the current context
   */
  // test("set current context", async () => {
  //   // Get available contexts
  //   const contextsResult = await client.request(
  //     {
  //       method: "tools/call",
  //       params: {
  //         name: "list_contexts",
  //         arguments: {
  //           showCurrent: true,
  //         },
  //       },
  //     },
  //     ListContextsResponseSchema
  //   );

  //   const contextsData = JSON.parse(contextsResult.content[0].text);

  //   // Find a context that is not the current one
  //   const otherContext = contextsData.contexts.find(
  //     (context: any) => !context.isCurrent
  //   );

  //   // Skip the test if there's only one context available
  //   if (!otherContext) {
  //     console.log("Skipping test: No alternative context available");
  //     return;
  //   }

  // console.log(`Setting current context to: ${otherContext.name}`);

  // // Set the current context to a different one
  // const result = await client.request(
  //   {
  //     method: "tools/call",
  //     params: {
  //       name: "set_current_context",
  //       arguments: {
  //         name: otherContext.name,
  //       },
  //     },
  //   },
  //   SetCurrentContextResponseSchema
  // );

  // // Verify the response structure
  // expect(result.content[0].type).toBe("text");

  // // Parse the response text
  // const responseData = JSON.parse(result.content[0].text);

  // // Verify that the context was set successfully
  // expect(responseData.success).toBe(true);
  // expect(responseData.message).toContain(`Current context set to '${otherContext.name}'`);
  // expect(responseData.context).toBe(otherContext.name);

  // // Verify that the current context has actually changed
  // const verifyResult = await client.request(
  //   {
  //     method: "tools/call",
  //     params: {
  //       name: "get_current_context",
  //       arguments: {
  //         detailed: false,
  //       },
  //     },
  //   },
  //   GetCurrentContextResponseSchema
  // );

  // const verifyData = JSON.parse(verifyResult.content[0].text);
  // expect(verifyData.currentContext).toBe(otherContext.name);

  // // Skip the direct KubeConfig verification since it's being restored in afterEach
  // // and there's a race condition between the test and the afterEach hook
  // // Instead, we'll just verify the response from the API

  // console.log("Context successfully changed and verified");
  // });
});
