#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  try {
    // Create a transport to the MCP server with non-destructive tools only
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      stderr: "pipe",
      env: {
        ...process.env,
        ALLOW_ONLY_NON_DESCTRUCTIVE_TOOLS: "true"
      }
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

    // List all available tools
    console.log("Listing tools...");
    const tools = await client.listTools();
    
    // Check if destructive tools are excluded
    const destructiveToolNames = [
      "delete_pod", 
      "delete_deployment", 
      "delete_namespace", 
      "uninstall_helm_chart", 
      "delete_cronjob",
      "cleanup"
    ];
    
    const foundDestructiveTools = tools.tools
      .filter(tool => destructiveToolNames.includes(tool.name))
      .map(tool => tool.name);
    
    if (foundDestructiveTools.length > 0) {
      console.error("ERROR: Found destructive tools that should have been excluded:", foundDestructiveTools);
    } else {
      console.log("SUCCESS: No destructive tools found in the list");
    }
    
    console.log(`Total tools available: ${tools.tools.length}`);
    
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
