import { expect, test, describe, beforeAll, afterAll } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { startSSEServer } from "../src/utils/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";
import { kubectlListSchema, kubectlList } from "../src/tools/kubectl-list.js";
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import net from "net";

// Helper function to find an available port
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = (server.address() as net.AddressInfo)?.port;
      server.close(() => {
        resolve(port);
      });
    });
    server.on('error', () => {
      // Try next port
      findAvailablePort(startPort + 1).then(resolve).catch(reject);
    });
  });
}

// Modified version of startSSEServer that returns the Express app
function startSSEServerWithReturn(server: Server): Promise<any> {
  return new Promise((resolve, reject) => {
    const app = express();
    let transports: Array<SSEServerTransport> = [];

    app.get("/sse", async (req, res) => {
      const transport = new SSEServerTransport("/messages", res);
      transports.push(transport);
      await server.connect(transport);
    });

    app.post("/messages", (req, res) => {
      const transport = transports.find(
        (t) => t.sessionId === req.query.sessionId
      );

      if (transport) {
        transport.handlePostMessage(req, res);
      } else {
        res
          .status(404)
          .send("Not found. Must pass valid sessionId as query param.");
      }
    });

    const port = parseInt(process.env.PORT || "3000");
    const serverInstance = app.listen(port, () => {
      console.log(
        `mcp-kubernetes-server is listening on port ${port}\nUse the following url to connect to the server:\nhttp://localhost:${port}/sse`
      );
      resolve(serverInstance);
    });
    
    serverInstance.on('error', reject);
  });
}

describe("SSE transport", () => {
  let server: Server;
  let serverUrl: string;
  let actualPort: number;
  let expressApp: any;

  beforeAll(async () => {
    const k8sManager = new KubernetesManager();

    // Create a minimal server with just the kubectl_list tool
    server = new Server(
      {
        name: "test-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Set up the kubectl_list tool
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [kubectlListSchema],
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: input = {} } = request.params;

      switch (name) {
        case "kubectl_list":
          return await kubectlList(k8sManager, input as { 
            resourceType: string;
            namespace?: string;
            output?: string;
            allNamespaces?: boolean;
            labelSelector?: string;
            fieldSelector?: string;
          });
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // Find an available port instead of using a fixed one
    actualPort = await findAvailablePort(3001);
    process.env.PORT = actualPort.toString();
    
    // Start the SSE server and get the Express app reference
    expressApp = await startSSEServerWithReturn(server);
    serverUrl = `http://localhost:${actualPort}`;
    
    // Wait a bit for server to fully start
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    try {
      if (expressApp && expressApp.close) {
        expressApp.close();
      }
      await server.close();
    } catch (error) {
      console.warn("Error during cleanup:", error);
    }
  });

  test("SSE connection and tool call", async () => {
    // Step 1: Connect to SSE endpoint
    const sseResponse = await fetch(`${serverUrl}/sse`);
    expect(sseResponse.status).toBe(200);

    // Get the session ID from the endpoint event
    const reader = sseResponse.body?.getReader();
    const decoder = new TextDecoder();
    let sessionId: string | undefined;

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("event: endpoint")) {
          const dataLine = lines[lines.indexOf(line) + 1];
          const data = dataLine.replace("data: ", "");
          sessionId = data.split("sessionId=")[1];
          break;
        }
      }

      if (sessionId) break;
    }

    expect(sessionId).toBeDefined();

    // Step 2: Make a tool call using the session ID
    const toolCallResponse = await fetch(
      `${serverUrl}/messages?sessionId=${sessionId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1234,
          method: "tools/call",
          params: {
            name: "kubectl_list",
            arguments: {
              resourceType: "pods",
              namespace: "default",
              output: "json"
            }
          },
        }),
      }
    );

    expect(toolCallResponse.status).toBe(202);
    expect(await toolCallResponse.text()).toBe("Accepted");

    // Step 3: Read the SSE response for the tool call result
    let toolCallResult: any;
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("event: message")) {
          const dataLine = lines[lines.indexOf(line) + 1];
          toolCallResult = JSON.parse(dataLine.replace("data: ", ""));
          break;
        }
      }

      if (toolCallResult) break;
    }

    // Verify the tool call result
    expect(toolCallResult.jsonrpc).toBe("2.0");
    expect(toolCallResult.id).toBe(1234);
    if (toolCallResult.result) {
      expect(toolCallResult.result.content[0].type).toBe("text");
      const responseText = toolCallResult.result.content[0].text;
      
      // If it's JSON, parse it and check structure
      try {
        const parsedResponse = JSON.parse(responseText);
        expect(parsedResponse.items).toBeDefined();
        expect(Array.isArray(parsedResponse.items)).toBe(true);
      } catch (e) {
        // If not JSON (formatted output), just check it contains pod data
        expect(responseText).toContain("NAME");
        expect(responseText).toContain("NAMESPACE");
      }
    }
  });
});
