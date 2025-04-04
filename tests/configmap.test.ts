import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateNamespaceResponseSchema } from "../src/types";
import {CreateConfigMapResponseSchema} from "../src/models/response-schemas.js";
import { KubernetesManager } from "../src/types";
async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function generateRandomId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  function generateRandomSHA(): string {
    return Math.random().toString(36).substring(2, 15);
  }


  describe("test kubernetes configmap",()=> {
    let transport: StdioClientTransport;
    let client: Client;
    const NAMESPACE_PREFIX = "test-configmap";
    let testNamespace : string;

    const testName = `test-configmap-${generateRandomSHA()}`

    beforeEach(async () =>{
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
                  // Wait for connection to be established
                  await sleep(1000);
            
                  // Create a unique test namespace for test isolation
                 testNamespace = `${NAMESPACE_PREFIX}-${generateRandomId()}`;
                  console.log(`Creating test namespace: ${testNamespace}`);
            
                  await client.request(
                    {
                      method: "tools/call",
                      params: {
                        name: "create_namespace",
                        arguments: {
                          name: testNamespace,
                        },
                      },
                    },
                    CreateNamespaceResponseSchema
                  );
            
                  // Wait for namespace to be fully created
                  await sleep(2000);
        } catch (error : any) {
            console.error("Error in beforeEach:", error);
            throw error;
        }
    });

    afterEach(async () => {
        try {
          // Clean up namespace using direct API call
          console.log(`Cleaning up test namespace: ${testNamespace}`);
          const k8sManager = new KubernetesManager();
          await k8sManager.getCoreApi().deleteNamespace(testNamespace);
    
          // Close client connection
          await transport.close();
          await sleep(1000);
        } catch (e) {
          console.error("Error during cleanup:", e);
        }
      });

      test("verify creation of configmap",async () =>{
        const testdata = {
            key1: "hello",
            key2: "world",
          };
        const configmap_response = client.request(
          {
            method : "tools/call",
            params : {
              name : "create_configmap",
              arguments : {
                name : testName,
                namespace : testNamespace,
                data : testdata,
              },
            },
          },
          CreateConfigMapResponseSchema,
        );

        await sleep(2000); 
        console.log((await configmap_response).content[0]);
        expect((await configmap_response).content[0].success).toBe(true);
        expect((await configmap_response).content[0].message).toContain(`Created ConfigMap ${testName} in namespace ${testNamespace}`);


      }
    );
  });