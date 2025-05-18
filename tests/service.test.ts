// This test file is used to test Kubernetes Service functionalities
import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateNamespaceResponseSchema } from "../src/types";
import { KubernetesManager } from "../src/types";
import { z } from "zod";

// Define the schema for the Service response
const ServiceResponseSchema = z.any();

// Interface for service response type
interface ServiceResponse {
  serviceName: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: Array<{
    port: number;
    targetPort: number | string;
    protocol: string;
    name: string;
    nodePort?: number;
  }>;
  status: string;
}

// Interface for list services response
interface ListServicesResponse {
  services: Array<{
    name: string;
    namespace: string;
    type: string;
    clusterIP: string;
    ports: Array<any>;
    createdAt: string;
  }>;
}

// Interface for update service response
interface UpdateServiceResponse {
  message: string;
  service: {
    name: string;
    namespace: string;
    type: string;
    clusterIP: string;
    ports: Array<any>;
  };
}

// Interface for delete service response
interface DeleteServiceResponse {
  success: boolean;
  status: string;
}

// Define the response type for easier use in tests
type KubectlResponse = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

// Utility function: Sleep for a specified number of milliseconds
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Utility function: Generate a random ID string
function generateRandomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Utility function: Generate a random SHA string for resource naming in tests
function generateRandomSHA(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Utility function: Parse JSON response
function parseServiceResponse(responseText: string): ServiceResponse | null {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Failed to parse service response:", error);
    return null;
  }
}

// Utility function: Parse list services response
function parseListServicesResponse(responseText: string): ListServicesResponse | null {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Failed to parse list services response:", error);
    return null;
  }
}

// Utility function: Parse update service response
function parseUpdateServiceResponse(responseText: string): UpdateServiceResponse | null {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Failed to parse update service response:", error);
    return null;
  }
}

// Utility function: Parse delete service response
function parseDeleteServiceResponse(responseText: string): DeleteServiceResponse | null {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Failed to parse delete service response:", error);
    return null;
  }
}

// Test suite: Testing Service functionality
describe("test kubernetes service", () => {
  let transport: StdioClientTransport;
  let client: Client;
  const NAMESPACE_PREFIX = "test-service";
  let testNamespace: string;

  const testServiceName = `test-service-${generateRandomSHA()}`;

  // Setup before each test
  beforeEach(async () => {
    try {
      // Initialize client transport layer, communicating with the service process via stdio
      transport = new StdioClientTransport({
        command: "bun",
        args: ["src/index.ts"],
        stderr: "pipe",
      });

      // Create an instance of the MCP client
      client = new Client(
        {
          name: "test-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      // Connect to the service
      await client.connect(transport);
      // Wait for the connection to be established
      await sleep(1000);

      // Create a unique test namespace to isolate the test environment
      testNamespace = `${NAMESPACE_PREFIX}-${generateRandomId()}`;
      console.log(`Creating test namespace: ${testNamespace}`);

      // Call API to create the namespace using kubectl_create
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              resourceType: "namespace",
              name: testNamespace,
            },
          },
        },
        // @ts-ignore - Ignoring type error to get tests running
        z.any()
      );

      // Wait for the namespace to be fully created
      await sleep(2000);
    } catch (error: any) {
      console.error("Error in beforeEach:", error);
      throw error;
    }
  });

  // Cleanup after each test
  afterEach(async () => {
    try {
      // Clean up the test namespace by using kubectl_delete
      console.log(`Cleaning up test namespace: ${testNamespace}`);
      
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: {
              resourceType: "namespace",
              name: testNamespace,
            },
          },
        },
        // @ts-ignore - Ignoring type error to get tests running
        z.any()
      );

      // Close the client connection
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  // Test case: Create ClusterIP service
  test("create ClusterIP service", async () => {
    // Define test data
    const testPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }];
    const testSelector = { app: "test-app", tier: "backend" };
    
    // Create the service manifest
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: testSelector,
        ports: testPorts.map(p => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
          name: p.name
        })),
        type: "ClusterIP"
      }
    };
    
    // Create the service using kubectl_create
    const response = await client.request(
      {
        method: "tools/call",
        params: { 
          name: "kubectl_create", 
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        },
      },
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    ) as KubectlResponse;
    
    await sleep(1000);
    
    // Verify response
    expect(response.content[0].type).toBe("text");
    expect(response.content[0].text).toContain(testServiceName);
    expect(response.content[0].text).toContain("Service");
    
    // Verify service was created correctly using kubectl_get
    const getResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            output: "json"
          }
        }
      },
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    ) as KubectlResponse;
    
    const serviceJson = JSON.parse(getResponse.content[0].text);
    
    // Assert service properties
    expect(serviceJson.metadata.name).toBe(testServiceName);
    expect(serviceJson.metadata.namespace).toBe(testNamespace);
    expect(serviceJson.spec.type).toBe("ClusterIP");
    
    // Assert port configuration
    expect(serviceJson.spec.ports).toHaveLength(1);
    expect(serviceJson.spec.ports[0].port).toBe(80);
    expect(serviceJson.spec.ports[0].targetPort).toBe(8080);
  });

  // Test case: List services
  test("list services", async () => {
    // Define test data
    const testPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }];
    
    // First create a service to list
    const createResponse = await client.request<any>(
      { 
        method: "tools/call", 
        params: { 
          name: "create_service", 
          arguments: { 
            name: testServiceName, 
            namespace: testNamespace, 
            ports: testPorts
          } 
        } 
      }, 
      ServiceResponseSchema
    );
    await sleep(1000);
    
    // List the services using kubectl_list
    const response = await client.request<any>(
      { 
        method: "tools/call", 
        params: { 
          name: "kubectl_list", 
          arguments: { 
            resourceType: "services",
            namespace: testNamespace,
            output: "formatted"
          } 
        } 
      }, 
      ServiceResponseSchema
    );
    
    // Verify response
    const responseText = response.content[0].text;
    console.log("Services list response:", responseText);
    
    // Assert service is in the list
    expect(responseText).toContain(testServiceName);
    expect(responseText).toContain(testNamespace);
    expect(responseText).toContain("ClusterIP"); // Assuming default type is ClusterIP
    expect(responseText).toContain("80"); // The port we defined
  });

  // Test case: Describe service
  test("describe service", async () => {
    // Define test data
    const testPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }];
    const serviceSelector = { app: "test-app", component: "api" };
    
    // First create a service to describe
    const createResponse = await client.request<any>(
      { 
        method: "tools/call", 
        params: { 
          name: "create_service", 
          arguments: { 
            name: testServiceName, 
            namespace: testNamespace, 
            ports: testPorts,
            selector: serviceSelector,
            type: "ClusterIP"
          } 
        } 
      }, 
      ServiceResponseSchema
    );
    await sleep(1000);
    
    // List all services in the namespace using kubectl_list
    const listResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_list",
          arguments: {
            resourceType: "services",
            namespace: testNamespace,
            output: "formatted"
          }
        }
      },
      ServiceResponseSchema
    );
    console.log("Services list:", listResponse.content[0].text);
    
    // Get the service using kubectl_get
    const getResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            output: "json"
          }
        }
      },
      ServiceResponseSchema
    );
    
    const getServiceJson = JSON.parse(getResponse.content[0].text);
    console.log("Service GET response:", getServiceJson);
    
    // Describe the service using kubectl_describe
    const describeResponse = await client.request<any>(
      { 
        method: "tools/call", 
        params: { 
          name: "kubectl_describe", 
          arguments: { 
            resourceType: "service",
            name: testServiceName, 
            namespace: testNamespace 
          } 
        } 
      }, 
      ServiceResponseSchema
    );
    
    // Log the first part of the describe output
    console.log("Service describe output (first 150 chars):", describeResponse.content[0].text.substring(0, 150) + "...");
    
    // Verify service details from get response
    expect(getServiceJson).not.toBeNull();
    expect(getServiceJson.metadata.name).toBe(testServiceName);
    expect(getServiceJson.metadata.namespace).toBe(testNamespace);
    expect(getServiceJson.spec.ports).toHaveLength(1);
    expect(getServiceJson.spec.ports[0].port).toBe(80);
    expect(getServiceJson.spec.selector).toEqual(serviceSelector);
    
    // Verify the describe output contains key service information
    const describeOutput = describeResponse.content[0].text;
    expect(describeOutput).toContain(testServiceName);
    expect(describeOutput).toContain(testNamespace);
    expect(describeOutput).toContain("80");
    expect(describeOutput).toContain("ClusterIP");
  });

  // Test case: Update service
  test("update service", async () => {
    // Define test data
    const initialPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }];
    const updatedPorts = [{ port: 90, targetPort: 9090, protocol: "TCP", name: "http-updated" }];
    const serviceSelector = { app: "test-app", tier: "backend" };
    const testLabels = { environment: "test", managed: "mcp" };
    
    // First create a service to update - use kubectl_create
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: serviceSelector,
        ports: initialPorts.map(p => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
          name: p.name
        })),
        type: "ClusterIP"
      }
    };
    
    await client.request(
      { 
        method: "tools/call", 
        params: { 
          name: "kubectl_create", 
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        } 
      }, 
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    );
    
    await sleep(1000);
    
    // List all services in the namespace using kubectl_list
    const listBeforeResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_list",
          arguments: {
            resourceType: "services",
            namespace: testNamespace,
            output: "formatted"
          }
        }
      },
      ServiceResponseSchema
    );
    console.log("Services before update:", listBeforeResponse.content[0].text);
    
    // Get the service using kubectl_get
    const getResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            output: "json"
          }
        }
      },
      ServiceResponseSchema
    );
    
    const initialService = JSON.parse(getResponse.content[0].text);
    console.log("Initial service GET response:", initialService);
    
    // Verify initial service properties
    expect(initialService.spec.ports[0].port).toBe(80);
    expect(initialService.spec.ports[0].targetPort).toBe(8080);
    
    // Describe the service using kubectl_describe
    const describeResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_describe",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace
          }
        }
      },
      ServiceResponseSchema
    );
    console.log("Service DESCRIBE output:", describeResponse.content[0].text.substring(0, 150) + "...");
    
    // Use kubectl apply to modify the service with yaml
    const currentSpec = initialService.spec;
    const modifiedService = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
        labels: testLabels
      },
      spec: {
        ...currentSpec,
        ports: updatedPorts,
        selector: { ...serviceSelector, updated: "true" }
      }
    };
    
    // Apply the modified service using kubectl_apply
    const applyResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_apply",
          arguments: {
            manifest: JSON.stringify(modifiedService),
            namespace: testNamespace
          }
        }
      },
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    ) as KubectlResponse;
    console.log("Apply response:", applyResponse.content[0].text);
    await sleep(1000);
    
    // Update the service using kubectl_apply instead of update_service
    const updatedServiceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: { ...serviceSelector, updated: "true" },
        ports: updatedPorts.map(p => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
          name: p.name
        })),
        type: "ClusterIP"
      }
    };
    
    const updateResponse = await client.request(
      { 
        method: "tools/call", 
        params: { 
          name: "kubectl_apply", 
          arguments: { 
            manifest: JSON.stringify(updatedServiceManifest),
            namespace: testNamespace
          } 
        } 
      }, 
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    ) as KubectlResponse;
    
    await sleep(1000);
    
    // Verify response
    expect(updateResponse.content[0].type).toBe("text");
    expect(updateResponse.content[0].text).toContain(testServiceName);
    expect(updateResponse.content[0].text).toContain("configured");
    
    // Verify updated properties using kubectl_get
    const getUpdatedResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            output: "json"
          }
        }
      },
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    ) as KubectlResponse;
    
    const updatedService = JSON.parse(getUpdatedResponse.content[0].text);
    
    // Comprehensive verification of the updated service
    expect(updatedService.spec.ports[0].port).toBe(90);
    expect(updatedService.spec.ports[0].targetPort).toBe(9090);
    expect(updatedService.spec.ports[0].name).toBe("http-updated");
    expect(updatedService.spec.selector.updated).toBe("true");
    expect(updatedService.spec.type).toBe("ClusterIP");
  });

  // Test case: Delete service
  test("delete service", async () => {
    // Define test data
    const testPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }];
    const serviceSelector = { app: "test-app", component: "backend" };
    
    // First create a service to delete using kubectl_create
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: serviceSelector,
        ports: testPorts.map(p => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
          name: p.name
        })),
        type: "ClusterIP"
      }
    };
    
    await client.request(
      { 
        method: "tools/call", 
        params: { 
          name: "kubectl_create", 
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        } 
      }, 
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    );
    
    await sleep(1000);
    
    // List services to verify creation using kubectl_list
    const listBeforeResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_list",
          arguments: {
            resourceType: "services",
            namespace: testNamespace,
            output: "formatted"
          }
        }
      },
      ServiceResponseSchema
    );
    console.log("Services before deletion:", listBeforeResponse.content[0].text);
    
    // Get the service details using kubectl_get
    const getResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            output: "json"
          }
        }
      },
      ServiceResponseSchema
    );
    
    const serviceJson = JSON.parse(getResponse.content[0].text);
    console.log("Service before deletion:", serviceJson);
    
    // Verify service exists before deletion
    expect(serviceJson.metadata.name).toBe(testServiceName);
    expect(serviceJson.metadata.namespace).toBe(testNamespace);
    
    // Delete the service using kubectl_delete
    const deleteResponse = await client.request(
      { 
        method: "tools/call", 
        params: { 
          name: "kubectl_delete", 
          arguments: { 
            resourceType: "service",
            name: testServiceName, 
            namespace: testNamespace 
          } 
        } 
      }, 
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    ) as KubectlResponse;
    
    await sleep(1000);
    
    // Verify delete response
    expect(deleteResponse.content[0].type).toBe("text");
    expect(deleteResponse.content[0].text).toContain(testServiceName);
    expect(deleteResponse.content[0].text).toContain("deleted");
    
    // Create another service to demonstrate kubectl_delete instead of delete_service
    const secondServiceName = `${testServiceName}-second`;
    
    // Use kubectl_create to create the second service
    const secondServiceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: secondServiceName,
        namespace: testNamespace,
        labels: { "test": "true" }
      },
      spec: {
        selector: serviceSelector,
        ports: testPorts.map(p => ({
          protocol: p.protocol,
          port: p.port,
          targetPort: p.targetPort,
          name: p.name
        })),
        type: "ClusterIP"
      }
    };
    
    const createSecondResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: secondServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(secondServiceManifest)
          }
        }
      },
      ServiceResponseSchema
    );
    console.log("Second service creation response:", createSecondResponse.content[0].text);
    await sleep(1000);
    
    // Delete the second service using kubectl_delete instead of delete_service
    const deleteSecondResponse = await client.request(
      { 
        method: "tools/call", 
        params: { 
          name: "kubectl_delete", 
          arguments: { 
            resourceType: "service",
            name: secondServiceName, 
            namespace: testNamespace 
          } 
        } 
      }, 
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    ) as KubectlResponse;
    
    await sleep(1000);
    
    // Verify delete response
    expect(deleteSecondResponse.content[0].type).toBe("text");
    expect(deleteSecondResponse.content[0].text).toContain(secondServiceName);
    expect(deleteSecondResponse.content[0].text).toContain("deleted");
    
    // List services to verify deletion using kubectl_list
    const listAfterResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_list",
          arguments: {
            resourceType: "services",
            namespace: testNamespace,
            output: "formatted"
          }
        }
      },
      ServiceResponseSchema
    );
    
    const listAfterText = listAfterResponse.content[0].text;
    console.log("Services list after deletion:", listAfterText);
    
    // Verify services are deleted by checking the list output
    expect(listAfterText).not.toContain(testServiceName);
    expect(listAfterText).not.toContain(secondServiceName);
    
    // Get all services to double check
    const getAllResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "services",
            namespace: testNamespace,
            output: "json"
          }
        }
      },
      ServiceResponseSchema
    );
    
    // Parse the response and verify the service list is empty or doesn't contain our services
    const getAllJson = JSON.parse(getAllResponse.content[0].text);
    console.log("All services after deletion:", getAllJson);
    
    // Check if the items array is empty or doesn't contain our services
    if (getAllJson.items && getAllJson.items.length > 0) {
      const serviceNames = getAllJson.items.map((item: any) => item.metadata.name);
      expect(serviceNames).not.toContain(testServiceName);
      expect(serviceNames).not.toContain(secondServiceName);
    }
  });

  // Test case: Create NodePort service
  test("create NodePort service", async () => {
    // Define test data
    const testPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http", nodePort: 30080 }];
    const nodePortSelector = { app: "nodeport-app", tier: "frontend" };
    const nodePortServiceName = `${testServiceName}-nodeport`;
    
    // Create service using kubectl_create with manifest
    const nodePortServiceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: nodePortServiceName,
        namespace: testNamespace,
        labels: { "service-type": "nodeport", "test-case": "true" }
      },
      spec: {
        selector: nodePortSelector,
        type: "NodePort",
        ports: [
          {
            port: testPorts[0].port,
            targetPort: testPorts[0].targetPort,
            nodePort: testPorts[0].nodePort,
            protocol: testPorts[0].protocol,
            name: testPorts[0].name
          }
        ]
      }
    };
    
    // Create using kubectl_create
    const createResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: nodePortServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(nodePortServiceManifest)
          }
        }
      },
      ServiceResponseSchema
    );
    console.log("NodePort service creation response:", createResponse.content[0].text);
    await sleep(1000);
    
    // List services to verify creation
    const listResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_list",
          arguments: {
            resourceType: "services",
            namespace: testNamespace,
            output: "formatted"
          }
        }
      },
      ServiceResponseSchema
    );
    console.log("Services after NodePort creation:", listResponse.content[0].text);
    
    // Get the service details using kubectl_get
    const getResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: nodePortServiceName,
            namespace: testNamespace,
            output: "json"
          }
        }
      },
      ServiceResponseSchema
    );
    
    const serviceJson = JSON.parse(getResponse.content[0].text);
    console.log("NodePort service details:", serviceJson);
    
    // Describe the service using kubectl_describe
    const describeResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_describe",
          arguments: {
            resourceType: "service",
            name: nodePortServiceName,
            namespace: testNamespace
          }
        }
      },
      ServiceResponseSchema
    );
    console.log("NodePort service describe (first 150 chars):", describeResponse.content[0].text.substring(0, 150) + "...");
    
    // Comprehensive assertions on the service
    expect(serviceJson.metadata.name).toBe(nodePortServiceName);
    expect(serviceJson.metadata.namespace).toBe(testNamespace);
    expect(serviceJson.metadata.labels["service-type"]).toBe("nodeport");
    expect(serviceJson.spec.type).toBe("NodePort");
    expect(serviceJson.spec.selector).toEqual(nodePortSelector);
    
    // Verify port configuration
    expect(serviceJson.spec.ports).toHaveLength(1);
    expect(serviceJson.spec.ports[0].port).toBe(80);
    expect(serviceJson.spec.ports[0].targetPort).toBe(8080);
    expect(serviceJson.spec.ports[0].nodePort).toBe(30080);
    
    // Get the service in wide format to see exposed ports
    const getWideResponse = await client.request<any>(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: nodePortServiceName,
            namespace: testNamespace,
            output: "wide"
          }
        }
      },
      ServiceResponseSchema
    );
    console.log("NodePort service wide format:", getWideResponse.content[0].text);
    
    // Verify the service description contains NodePort information
    const describeOutput = describeResponse.content[0].text;
    expect(describeOutput).toContain("NodePort");
    expect(describeOutput).toContain("30080");
  });

  // Test case: Create LoadBalancer service
  test("create LoadBalancer service", async () => {
    // Define test data
    const testPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }];
    const lbServiceName = `${testServiceName}-lb`;
    const serviceSelector = { app: "lb-app", component: "frontend" };
    
    // Create LoadBalancer service using kubectl_create instead of create_service
    const lbServiceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: lbServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: serviceSelector,
        ports: testPorts.map(p => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
          name: p.name
        })),
        type: "LoadBalancer"
      }
    };
    
    const response = await client.request(
      { 
        method: "tools/call", 
        params: { 
          name: "kubectl_create", 
          arguments: {
            resourceType: "service",
            name: lbServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(lbServiceManifest)
          }
        } 
      },
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    ) as KubectlResponse;
    
    await sleep(1000);
    
    // Verify response
    expect(response.content[0].type).toBe("text");
    expect(response.content[0].text).toContain(lbServiceName);
    
    // Verify service using kubectl_get
    const getResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: lbServiceName,
            namespace: testNamespace,
            output: "json"
          }
        }
      },
      // @ts-ignore - Ignoring type error to get tests running
      z.any()
    ) as KubectlResponse;
    
    const serviceJson = JSON.parse(getResponse.content[0].text);
    
    // Assert service properties
    expect(serviceJson.metadata.name).toBe(lbServiceName);
    expect(serviceJson.metadata.namespace).toBe(testNamespace);
    expect(serviceJson.spec.type).toBe("LoadBalancer");
    
    // Assert port configuration
    expect(serviceJson.spec.ports).toHaveLength(1);
    expect(serviceJson.spec.ports[0].port).toBe(80);
    expect(serviceJson.spec.ports[0].targetPort).toBe(8080);
  });
});