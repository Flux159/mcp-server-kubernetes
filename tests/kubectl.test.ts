import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { KubectlResponseSchema } from "../src/models/kubectl-models.js";
import { GetEventsResponseSchema } from "../src/models/response-schemas.js";
import {PortForwardSchema} from "../src/tools/forward_port.js";
import {listPods} from "../src/tools/list_pods.js";
import { KubernetesManager } from "../src/types.ts";
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("kubectl operations", () => {
  let transport: StdioClientTransport;
  let client: Client;

  beforeEach(async () => {
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
      await sleep(1000);
    } catch (e) {
      console.error("Error in beforeEach:", e);
      throw e;
    }
  });

  afterEach(async () => {
    try {
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });
  test("explain resource", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "explain_resource",
          arguments: {
            resource: "pods",
            recursive: true,
          },
        },
      },
      KubectlResponseSchema
    );

    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    expect(text).toContain("KIND:       Pod");
    expect(text).toContain("VERSION:    v1");
    expect(text).toContain("DESCRIPTION:");
    expect(text).toContain("FIELDS:");
  });

  test("explain resource with api version", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "explain_resource",
          arguments: {
            resource: "deployments",
            apiVersion: "apps/v1",
            recursive: true,
          },
        },
      },
      KubectlResponseSchema
    );

    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    expect(text).toContain("KIND:       Deployment");
    expect(text).toContain("VERSION:    v1");
    expect(text).toContain("DESCRIPTION:");
    expect(text).toContain("FIELDS:");
  });

  test("list api resources", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_api_resources",
          arguments: {
            output: "wide",
          },
        },
      },
      KubectlResponseSchema
    );

    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    expect(text).toContain("NAME");
    expect(text).toContain("SHORTNAMES");
    expect(text).toContain("APIVERSION");
    expect(text).toContain("NAMESPACED");
    expect(text).toContain("KIND");
  });

  test("list api resources with filters", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_api_resources",
          arguments: {
            apiGroup: "apps",
            namespaced: true,
            verbs: ["get", "list"],
            output: "name",
          },
        },
      },
      KubectlResponseSchema
    );

    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    expect(text).toContain("deployments");
    expect(text).toContain("statefulsets");
    expect(text).toContain("daemonsets");
  });

  test("start_forwardport", async () => {
    const k8sManager = new KubernetesManager();
    const podsResponse = await listPods(k8sManager, { namespace: "default" });
    const pods = JSON.parse(podsResponse.content[0].text).pods;
    const resourcename = pods[0].name;
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "forward_port",
          arguments: {
            resourceType: "pod",
            resourceName: resourcename,
            localPort: 8080,
            targetPort: 80,
          },
        },
      },
      PortForwardSchema
    );
    expect(result.content[0].type).toBe("port-forward");
    expect(result.content[0].resourceType).toBe("pod");
  });


  /**
   * Test suite for get_events functionality
   * Tests retrieval of Kubernetes events with various filtering options
   */
  describe("get events", () => {
    test("get events from specific namespace", async () => {
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "get_events",
            arguments: {
              namespace: "default"
            }
          }
        },
        GetEventsResponseSchema
      );

      expect(result.content[0].type).toBe("text");
      const events = JSON.parse(result.content[0].text);
      expect(events.events).toBeDefined();
      expect(Array.isArray(events.events)).toBe(true);

      // Verify event object structure if events exist
      if (events.events.length > 0) {
        const event = events.events[0];
        expect(event).toHaveProperty("type");
        expect(event).toHaveProperty("reason");
        expect(event).toHaveProperty("message");
        expect(event).toHaveProperty("involvedObject");
        expect(event.involvedObject).toHaveProperty("kind");
        expect(event.involvedObject).toHaveProperty("name");
        expect(event.involvedObject).toHaveProperty("namespace");
        expect(event).toHaveProperty("firstTimestamp");
        expect(event).toHaveProperty("lastTimestamp");
        expect(event).toHaveProperty("count");
      }
    });

    test("get events from all namespaces", async () => {
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "get_events",
            arguments: {}
          }
        },
        GetEventsResponseSchema
      );

      expect(result.content[0].type).toBe("text");
      const events = JSON.parse(result.content[0].text);
      expect(events.events).toBeDefined();
      expect(Array.isArray(events.events)).toBe(true);
    });

    test("get events with field selector", async () => {
      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "get_events",
            arguments: {
              namespace: "default",
              fieldSelector: "type=Normal"
            }
          }
        },
        GetEventsResponseSchema
      );

      expect(result.content[0].type).toBe("text");
      const events = JSON.parse(result.content[0].text);
      expect(events.events).toBeDefined();
      expect(Array.isArray(events.events)).toBe(true);

      // Verify filtered events
      if (events.events.length > 0) {
        events.events.forEach((event: any) => {
          expect(event.type).toBe("Normal");
        });
      }
    });
  });
});
