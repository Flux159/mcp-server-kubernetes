#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    
    console.log("Connecting to MCP server...");
    await client.connect(transport);
    await sleep(1000); // Wait for connection to be established
    
    console.log("Connected to MCP server");

    // Call the list_contexts tool
    console.log("Calling list_contexts tool...");
    const response = await client.callTool("list_contexts", { showCurrent: true });
    console.log("Response:", JSON.stringify(response, null, 2));
    
    // Close the transport
    await transport.close();
    console.log("Done");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
