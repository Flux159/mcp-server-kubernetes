import { expect, test, describe, beforeAll, afterAll } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { startStreamableHTTPServer } from "../src/utils/streamable-http.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import http from "http";
import { pingSchema } from "../src/tools/ping.js";
import { findAvailablePort } from "./port-helper.js";

// Simple type guard for ListToolsResponse
function isListToolsResponse(data: any): boolean {
  return (
    data &&
    data.jsonrpc === "2.0" &&
    data.result &&
    Array.isArray(data.result.tools)
  );
}

describe("Streamable HTTP Server", () => {
  let server: Server;
  let httpServer: http.Server;
  let port: number;
  let url: string;

  beforeAll(async () => {
    port = await findAvailablePort(3001);
    url = `http://localhost:${port}/mcp`;

    // Create a server and register a handler for list_tools
    server = new Server(
      { name: "test-stream-server", version: "1.0.0" },
      { capabilities: { tools: {} } } // Enable the tools capability
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [pingSchema], // Return a simple tool schema
      };
    });

    process.env.PORT = port.toString();
    httpServer = startStreamableHTTPServer(server);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });

  test("should respond to readiness check", async () => {
    try {
      // Send a GET request to the /ready endpoint
      const readyUrl = `http://localhost:${port}/ready`;
      const response = await fetch(readyUrl, {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      });

      expect(response.status).toBe(200);

      const responseJson = await response.json();
      expect(responseJson.status).toBe("ready");
    } catch (error) {
      console.error("Error during readiness check:", error);
      throw error;
    }
  });

  test("should handle a full MCP session lifecycle", async () => {
    try {
      // Send a POST request and verify the response on the same channel
      const listToolsRequest = {
        jsonrpc: "2.0" as const,
        method: "tools/list" as const,
        params: {},
        id: 2,
      };
      const postResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(listToolsRequest),
      });
      expect(postResponse.status).toBe(200);

      // The response is expected directly on the POST request for this transport implementation
      const postResponseText = await postResponse.text();
      const messageLine = postResponseText
        .split("\n")
        .find((line) => line.startsWith("data:"));

      expect(messageLine).toBeDefined();
      const postResponseJson = JSON.parse(messageLine!.replace(/^data: /, ""));
      expect(isListToolsResponse(postResponseJson)).toBe(true);
      expect(postResponseJson.result.tools[0].name).toBe("ping");
    } catch (error) {
      console.error("Error during POST request:", error);
      throw error;
    }
  });
});
