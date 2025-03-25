import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export function startSSEServer(server: Server) {
  const app = express();

  // Currently just copying from docs & allowing for multiple transport connections: https://modelcontextprotocol.io/docs/concepts/transports#server-sent-events-sse
  // TODO: If exposed to web, then this will enable any client to connect to the server via http - so marked as UNSAFE until mcp has a proper auth solution.
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

  const port = process.env.PORT || 3000;
  app.listen(port);
  console.log(
    `mcp-kubernetes-server is listening on port ${port}\nUse the following url to connect to the server:\n\http://localhost:${port}/sse`
  );
}
