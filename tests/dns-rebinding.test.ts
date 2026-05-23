import { expect, test, describe, beforeAll, afterAll } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { startStreamableHTTPServer } from "../src/utils/streamable-http.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import http from "http";
import { pingSchema } from "../src/tools/ping.js";
import { findAvailablePort } from "./port-helper.js";

/** Send a POST /mcp request with a custom Host header via http.request (fetch doesn't allow Host override). */
function mcpPost(
  port: number,
  body: object,
  hostHeader: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          Host: hostHeader,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, body: data }));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function makeListToolsRequest(id: number) {
  return {
    jsonrpc: "2.0" as const,
    method: "tools/list" as const,
    params: {},
    id,
  };
}

function saveEnvKeys(keys: string[]): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return saved;
}

function restoreEnvKeys(saved: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Wait until the http.Server is actually listening. */
function waitForListening(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) return resolve();
    server.on("listening", resolve);
  });
}

const ENV_KEYS = ["DNS_REBINDING_PROTECTION", "DNS_REBINDING_ALLOWED_HOST", "HOST", "PORT"];

describe("DNS Rebinding Protection - enabled by default", () => {
  let httpServer: http.Server;
  let port: number;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    savedEnv = saveEnvKeys(ENV_KEYS);
    port = await findAvailablePort(5000);
    process.env.PORT = port.toString();
    // Bind to 127.0.0.1 so mcpPost can reach it
    process.env.HOST = "127.0.0.1";
    // Do NOT set DNS_REBINDING_PROTECTION — should default to enabled

    const server = new Server(
      { name: "test-dns-default", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: [pingSchema] };
    });
    httpServer = startStreamableHTTPServer(server);
    await waitForListening(httpServer);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    restoreEnvKeys(savedEnv);
  });

  test("should reject requests with a foreign Host header by default", async () => {
    const res = await mcpPost(port, makeListToolsRequest(1), "evil.attacker.com");
    // With DNS rebinding protection enabled by default, foreign Host should be rejected
    expect(res.status).toBe(403);
  });

  test("should allow requests with the default localhost Host header", async () => {
    const res = await mcpPost(port, makeListToolsRequest(2), `127.0.0.1:${port}`);
    expect(res.status).toBe(200);
  });
});

describe("DNS Rebinding Protection - explicit opt-out", () => {
  let httpServer: http.Server;
  let port: number;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    savedEnv = saveEnvKeys(ENV_KEYS);
    port = await findAvailablePort(5100);
    process.env.PORT = port.toString();
    process.env.HOST = "127.0.0.1";
    process.env.DNS_REBINDING_PROTECTION = "false";

    const server = new Server(
      { name: "test-dns-disabled", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: [pingSchema] };
    });
    httpServer = startStreamableHTTPServer(server);
    await waitForListening(httpServer);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    restoreEnvKeys(savedEnv);
  });

  test("should allow requests with a foreign Host header when explicitly disabled", async () => {
    const res = await mcpPost(port, makeListToolsRequest(3), "evil.attacker.com");
    // When explicitly disabled, should allow any host
    expect(res.status).toBe(200);
  });
});

describe("DNS Rebinding Protection - warning on 0.0.0.0 without protection", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    savedEnv = saveEnvKeys(ENV_KEYS);
  });

  afterAll(async () => {
    restoreEnvKeys(savedEnv);
  });

  test("should log a warning when HOST=0.0.0.0 and protection is explicitly disabled", async () => {
    const port = await findAvailablePort(5200);
    process.env.PORT = port.toString();
    process.env.HOST = "0.0.0.0";
    process.env.DNS_REBINDING_PROTECTION = "false";

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: any[]) => {
      warnings.push(args.join(" "));
    };

    let hs: http.Server | undefined;
    try {
      const server = new Server(
        { name: "test-dns-warn", version: "1.0.0" },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: [pingSchema] };
      });
      hs = startStreamableHTTPServer(server);
      await waitForListening(hs);

      const hasDnsWarning = warnings.some(
        (w) => w.toLowerCase().includes("dns rebinding")
      );
      expect(hasDnsWarning).toBe(true);
    } finally {
      console.warn = originalWarn;
      if (hs) {
        await new Promise<void>((resolve, reject) => {
          hs!.close((err) => (err ? reject(err) : resolve()));
        });
      }
    }
  });
});
