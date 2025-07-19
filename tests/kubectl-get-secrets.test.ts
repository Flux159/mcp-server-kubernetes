import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { KubectlResponseSchema } from "../src/models/kubectl-models.js";
import { asResponseSchema } from "./context-helper";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to retry operations that might be flaky
async function retry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 2000
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(
        `Attempt ${attempt}/${maxRetries} failed. Retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

describe("kubectl get secrets masking functionality", () => {
  // Helper function to create client with specific environment
  async function createClientWithEnv(maskSecrets?: string): Promise<{transport: StdioClientTransport, client: Client}> {
    const env = { ...process.env };
    if (maskSecrets !== undefined) {
      env.MASK_SECRETS = maskSecrets;
    } else {
      delete env.MASK_SECRETS;
    }
    
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["src/index.ts"],
      stderr: "pipe",
      env: env
    });

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
    await sleep(2000);
    
    return { transport, client };
  }

  // Helper function to cleanup client
  async function cleanupClient(transport: StdioClientTransport) {
    try {
      await transport.close();
      await sleep(2000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  }

  describe("integration tests with MASK_SECRETS environment variable", () => {
    test("should mask secrets when MASK_SECRETS=true", async () => {
      const { transport, client } = await createClientWithEnv("true");
      
      try {
        // Create a test secret first
        const createResult = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_apply",
                arguments: {
                  manifest: `
apiVersion: v1
kind: Secret
metadata:
  name: test-masking-secret
  namespace: default
type: Opaque
data:
  username: dGVzdC11c2VybmFtZQ==
  password: dGVzdC1wYXNzd29yZA==
  config: ewogICJkYjpuYW1lIjogInRlc3QtZGF0YWJhc2UiLAogICJob3N0IjogInRlc3QtaG9zdCIKfQ==
`,
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(createResult.content[0].type).toBe("text");

        // Now get the secret and verify it's masked
        const result = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_get",
                arguments: {
                  resourceType: "secrets",
                  name: "test-masking-secret",
                  namespace: "default",
                  output: "json",
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(result.content[0].type).toBe("text");
        const secretData = JSON.parse(result.content[0].text);
        
        // Verify that data fields are masked
        expect(secretData.data).toBeDefined();
        expect(secretData.data.username).toBe("***");
        expect(secretData.data.password).toBe("***");
        expect(secretData.data.config).toBe("***");
        
        // Verify that non-data fields are not masked
        expect(secretData.metadata.name).toBe("test-masking-secret");
        expect(secretData.metadata.namespace).toBe("default");
        expect(secretData.kind).toBe("Secret");

        // Clean up
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "secret",
                name: "test-masking-secret",
                namespace: "default",
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );
      } finally {
        await cleanupClient(transport);
      }
    });

    test("should not mask secrets when MASK_SECRETS=false", async () => {
      const { transport, client } = await createClientWithEnv("false");
      
      try {
        // Create a test secret first
        const createResult = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_apply",
                arguments: {
                  manifest: `
apiVersion: v1
kind: Secret
metadata:
  name: test-unmasked-secret
  namespace: default
type: Opaque
data:
  username: dGVzdC11c2VybmFtZQ==
  password: dGVzdC1wYXNzd29yZA==
`,
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(createResult.content[0].type).toBe("text");

        // Now get the secret and verify it's not masked
        const result = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_get",
                arguments: {
                  resourceType: "secrets",
                  name: "test-unmasked-secret",
                  namespace: "default",
                  output: "json",
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(result.content[0].type).toBe("text");
        const secretData = JSON.parse(result.content[0].text);
        
        // Verify that data fields are NOT masked
        expect(secretData.data).toBeDefined();
        expect(secretData.data.username).toBe("dGVzdC11c2VybmFtZQ==");
        expect(secretData.data.password).toBe("dGVzdC1wYXNzd29yZA==");

        // Clean up
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "secret",
                name: "test-unmasked-secret",
                namespace: "default",
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );
      } finally {
        await cleanupClient(transport);
      }
    });

    test("should mask secrets when MASK_SECRETS is unset (default behavior)", async () => {
      const { transport, client } = await createClientWithEnv();
      
      try {
        // Create a test secret first
        const createResult = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_apply",
                arguments: {
                  manifest: `
apiVersion: v1
kind: Secret
metadata:
  name: test-default-secret
  namespace: default
type: Opaque
data:
  username: dGVzdC11c2VybmFtZQ==
`,
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(createResult.content[0].type).toBe("text");

        // Now get the secret and verify it's not masked (default behavior)
        const result = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_get",
                arguments: {
                  resourceType: "secrets",
                  name: "test-default-secret",
                  namespace: "default",
                  output: "json",
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(result.content[0].type).toBe("text");
        const secretData = JSON.parse(result.content[0].text);
        
        // Verify that data fields are masked (default behavior)
        expect(secretData.data).toBeDefined();
        expect(secretData.data.username).toBe("***");

        // Clean up
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "secret",
                name: "test-default-secret",
                namespace: "default",
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );
      } finally {
        await cleanupClient(transport);
      }
    });
  });

  describe("output format tests", () => {
    test("should mask secrets in JSON output", async () => {
      const { transport, client } = await createClientWithEnv("true");
      
      try {
        const createResult = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_apply",
                arguments: {
                  manifest: `
apiVersion: v1
kind: Secret
metadata:
  name: test-json-secret
  namespace: default
type: Opaque
data:
  key1: dGVzdC12YWx1ZS0x
  key2: dGVzdC12YWx1ZS0y
`,
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        const result = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_get",
                arguments: {
                  resourceType: "secrets",
                  name: "test-json-secret",
                  namespace: "default",
                  output: "json",
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(result.content[0].type).toBe("text");
        const secretData = JSON.parse(result.content[0].text);
        expect(secretData.data.key1).toBe("***");
        expect(secretData.data.key2).toBe("***");

        // Clean up
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "secret",
                name: "test-json-secret",
                namespace: "default",
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );
      } finally {
        await cleanupClient(transport);
      }
    });

    test("should mask secrets in YAML output", async () => {
      const { transport, client } = await createClientWithEnv("true");
      
      try {
        const createResult = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_apply",
                arguments: {
                  manifest: `
apiVersion: v1
kind: Secret
metadata:
  name: test-yaml-secret
  namespace: default
type: Opaque
data:
  yamlkey: dGVzdC15YW1sLXZhbHVl
`,
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        const result = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_get",
                arguments: {
                  resourceType: "secrets",
                  name: "test-yaml-secret",
                  namespace: "default",
                  output: "yaml",
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(result.content[0].type).toBe("text");
        const yamlOutput = result.content[0].text;
        
        // Verify that the output contains masked values
        expect(yamlOutput).toContain("yamlkey: '***'");
        // Verify that metadata is not masked
        expect(yamlOutput).toContain("name: test-yaml-secret");

        // Clean up
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "secret",
                name: "test-yaml-secret",
                namespace: "default",
              },
            },
          },
          asResponseSchema(KubectlResponseSchema)
        );
      } finally {
        await cleanupClient(transport);
      }
    });
  });

  describe("edge cases and error handling", () => {
    test("should only mask secrets, not other resource types", async () => {
      const { transport, client } = await createClientWithEnv("true");
      
      try {
        // Test with configmaps to ensure they're not masked
        const result = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_get",
                arguments: {
                  resourceType: "configmaps",
                  namespace: "default",
                  output: "json",
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(result.content[0].type).toBe("text");
        // Should succeed without masking since it's not secrets
        const configData = JSON.parse(result.content[0].text);
        expect(configData).toBeDefined();
      } finally {
        await cleanupClient(transport);
      }
    });

    test("should handle malformed secrets gracefully", async () => {
      const { transport, client } = await createClientWithEnv("true");
      
      try {
        // Test with non-existent secret
        const result = await retry(async () => {
          return await client.request(
            {
              method: "tools/call",
              params: {
                name: "kubectl_get",
                arguments: {
                  resourceType: "secrets",
                  name: "non-existent-test-secret",
                  namespace: "default",
                  output: "json",
                },
              },
            },
            asResponseSchema(KubectlResponseSchema)
          );
        });

        expect(result.content[0].type).toBe("text");
        const errorData = JSON.parse(result.content[0].text);
        expect(errorData.error).toContain("not found");
        expect(errorData.status).toBe("not_found");
      } finally {
        await cleanupClient(transport);
      }
    });
  });
});