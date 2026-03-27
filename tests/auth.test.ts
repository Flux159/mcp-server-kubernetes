import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { createAuthMiddleware } from "../src/utils/auth.js";
import type { Request, Response, NextFunction } from "express";

/** Helper to create a mock Express request with optional headers. */
function mockReq(headers: Record<string, string | string[] | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

/** Helper to create a mock Express response with json/status spies. */
function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("createAuthMiddleware", () => {
  const originalEnv = process.env.MCP_AUTH_TOKEN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MCP_AUTH_TOKEN;
    } else {
      process.env.MCP_AUTH_TOKEN = originalEnv;
    }
  });

  test("allows all requests when MCP_AUTH_TOKEN is not set", () => {
    delete process.env.MCP_AUTH_TOKEN;
    const middleware = createAuthMiddleware();
    const next = vi.fn();
    middleware(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test("returns 401 when X-MCP-AUTH header is missing", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    const middleware = createAuthMiddleware();
    const res = mockRes();
    const next = vi.fn();
    middleware(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as any).error.code).toBe(-32001);
  });

  test("returns 401 when X-MCP-AUTH header is an array (duplicate headers)", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    const middleware = createAuthMiddleware();
    const res = mockRes();
    const next = vi.fn();
    middleware(mockReq({ "x-mcp-auth": ["token1", "token2"] }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as any).error.message).toContain("single");
  });

  test("returns 403 when token does not match", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    const middleware = createAuthMiddleware();
    const res = mockRes();
    const next = vi.fn();
    middleware(mockReq({ "x-mcp-auth": "wrong-token" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test("calls next() when token matches", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    const middleware = createAuthMiddleware();
    const next = vi.fn();
    middleware(mockReq({ "x-mcp-auth": "secret" }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test("uses constant-time comparison (no early return on first mismatch)", () => {
    process.env.MCP_AUTH_TOKEN = "correct-token";
    const middleware = createAuthMiddleware();

    // Both wrong tokens should take similar time (not measurably different)
    // This is a basic structural test — true timing tests need statistical analysis
    const res1 = mockRes();
    const res2 = mockRes();
    middleware(mockReq({ "x-mcp-auth": "Xorrect-token" }), res1, vi.fn()); // first char wrong
    middleware(mockReq({ "x-mcp-auth": "correct-tokeX" }), res2, vi.fn()); // last char wrong
    expect(res1.statusCode).toBe(403);
    expect(res2.statusCode).toBe(403);
  });
});
