#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  try {
    // Create a transport to the MCP server
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      stderr: "pipe",
    });

    // Create and connect the client
    const client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
    await client.connect(transport);

    // List available tools
    const toolsResponse = await client.listTools();
    console.log("Available tools:", toolsResponse.tools.map(tool => tool.name));

    // Call the list_contexts tool
    const contextResponse = await client.callTool("list_contexts", { showCurrent: true });
    console.log("Contexts response:", JSON.stringify(contextResponse, null, 2));

    // Close the transport
    await transport.close();
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
