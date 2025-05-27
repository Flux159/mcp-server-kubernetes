import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { HelmResponseSchema } from "../src/models/helm-models.js";
import * as fs from "fs";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to wait for cluster readiness
async function waitForClusterReadiness(
  client: Client,
  namespace: string
): Promise<void> {
  let attempts = 0;
  const maxAttempts = 20;
  const waitTime = 4000;

  while (attempts < maxAttempts) {
    try {
      // First check if namespace exists
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_namespaces",
            arguments: {},
          },
        },
        HelmResponseSchema
      );

      // Then check if we can list services
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "list_services",
            arguments: {
              namespace: namespace,
            },
          },
        },
        HelmResponseSchema
      );
      return;
    } catch (e) {
      attempts++;
      if (attempts === maxAttempts) {
        throw new Error(
          `Cluster not ready after ${maxAttempts} attempts. Last error: ${e.message}`
        );
      }
      await sleep(waitTime);
    }
  }
}

describe("helm operations", () => {
  let transport: StdioClientTransport;
  let client: Client;
  const testReleaseName = "test-nginx";
  const testNamespace = "default-helm";

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
      // Cleanup: Uninstall the test release if it exists
      await client
        .request(
          {
            method: "tools/call",
            params: {
              name: "uninstall_helm_chart",
              arguments: {
                name: testReleaseName,
                namespace: testNamespace,
              },
            },
          },
          HelmResponseSchema
        )
        .catch(() => {}); // Ignore errors if release doesn't exist

      await transport.close();
      await sleep(1000);

      // Cleanup generated values files
      if (fs.existsSync("test-nginx-values.yaml")) {
        fs.unlinkSync("test-nginx-values.yaml");
      }
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  test("helm chart values validation", async () => {
    // Try installing a chart with complex nested values
    const installResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "install_helm_chart",
          arguments: {
            name: testReleaseName,
            chart: "bitnami/nginx",
            repo: "https://charts.bitnami.com/bitnami",
            namespace: testNamespace,
            values: {
              replicaCount: 1,
              service: {
                type: "ClusterIP",
                port: 80,
                annotations: {
                  "test.annotation": "value"
                }
              },
              resources: {
                limits: {
                  cpu: "100m",
                  memory: "128Mi"
                },
                requests: {
                  cpu: "50m",
                  memory: "64Mi"
                }
              },
              metrics: {
                enabled: true,
                service: {
                  annotations: {
                    "prometheus.io/scrape": "true"
                  }
                }
              }
            }
          }
        }
      },
      HelmResponseSchema
    );

    expect(installResult.content[0].type).toBe("text");
    const response = JSON.parse(installResult.content[0].text);
    expect(response.status).toBe("installed");

    // Clean up after test
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "uninstall_helm_chart",
          arguments: {
            name: testReleaseName,
            namespace: testNamespace
          }
        }
      },
      HelmResponseSchema
    );
  }, 60000);

  test("helm chart lifecycle", async () => {
    // Create namespace if it doesn't exist
    try {
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
        HelmResponseSchema
      );
      // Wait for namespace to be ready
      await sleep(2000);
    } catch (e) {
      // Ignore error if namespace already exists
    }

    // Ensure cluster is ready before starting
    await waitForClusterReadiness(client, testNamespace);

    // First ensure any existing release is cleaned up
    try {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "uninstall_helm_chart",
            arguments: {
              name: testReleaseName,
              namespace: testNamespace,
            },
          },
        },
        HelmResponseSchema
      );
      // Wait for cleanup
      await sleep(5000);
    } catch (e) {
      // Ignore errors if release doesn't exist
    }

    // Verify no existing deployment
    const initialCheckResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_deployments",
          arguments: {
            namespace: testNamespace,
          },
        },
      },
      HelmResponseSchema
    );

    const initialDeploymentsCheck = JSON.parse(
      initialCheckResult.content[0].text
    );
    expect(
      initialDeploymentsCheck.deployments.every(
        (d: any) => !d.name.startsWith(testReleaseName)
      )
    ).toBe(true);

    // Step 1: Install the chart
    const installResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "install_helm_chart",
          arguments: {
            name: testReleaseName,
            chart: "bitnami/nginx",
            repo: "https://charts.bitnami.com/bitnami",
            namespace: testNamespace,
            values: {
              service: {
                type: "ClusterIP",
              },
              resources: {
                limits: {
                  cpu: "100m",
                  memory: "128Mi",
                },
                requests: {
                  cpu: "50m",
                  memory: "64Mi",
                },
              },
            },
          },
        },
      },
      HelmResponseSchema
    );

    expect(installResult.content[0].type).toBe("text");
    const installResponse = JSON.parse(installResult.content[0].text);
    expect(installResponse.status).toBe("installed");

    // Wait for initial deployment to be ready
    await sleep(20000);

    // Verify initial deployment
    const initialDeploymentResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_deployments",
          arguments: {
            namespace: testNamespace,
          },
        },
      },
      HelmResponseSchema
    );

    const initialDeploymentsAfterInstall = JSON.parse(
      initialDeploymentResult.content[0].text
    );
    expect(
      initialDeploymentsAfterInstall.deployments.some((d: any) =>
        d.name.startsWith(testReleaseName)
      )
    ).toBe(true);

    // Step 2: Upgrade the chart
    await waitForClusterReadiness(client, testNamespace);

    const upgradeResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "upgrade_helm_chart",
          arguments: {
            name: testReleaseName,
            chart: "bitnami/nginx",
            repo: "https://charts.bitnami.com/bitnami",
            namespace: testNamespace,
            values: {
              replicaCount: 2,
              service: {
                type: "ClusterIP",
              },
            },
          },
        },
      },
      HelmResponseSchema
    );

    expect(upgradeResult.content[0].type).toBe("text");
    const upgradeResponse = JSON.parse(upgradeResult.content[0].text);
    expect(upgradeResponse.status).toBe("upgraded");

    // Wait for upgrade to take effect
    await sleep(30000);

    // Verify the deployment was updated
    const deploymentResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_deployments",
          arguments: {
            namespace: testNamespace,
          },
        },
      },
      HelmResponseSchema
    );

    const deployments = JSON.parse(deploymentResult.content[0].text);
    const nginxDeployment = deployments.deployments.find((d: any) =>
      d.name.startsWith(testReleaseName)
    );

    expect(nginxDeployment).toBeDefined();
    expect(nginxDeployment.replicas).toBe(2);

    // Step 3: Uninstall the chart
    await waitForClusterReadiness(client, testNamespace);

    const uninstallResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "uninstall_helm_chart",
          arguments: {
            name: testReleaseName,
            namespace: testNamespace,
          },
        },
      },
      HelmResponseSchema
    );

    expect(uninstallResult.content[0].type).toBe("text");
    const uninstallResponse = JSON.parse(uninstallResult.content[0].text);
    expect(uninstallResponse.status).toBe("uninstalled");

    // Wait for resources to be cleaned up
    await sleep(20000);

    // Verify the deployment is gone
    const finalDeploymentResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "list_deployments",
          arguments: {
            namespace: testNamespace,
          },
        },
      },
      HelmResponseSchema
    );

    const finalDeployments = JSON.parse(finalDeploymentResult.content[0].text);
    expect(
      finalDeployments.deployments.every(
        (d: any) => !d.name.startsWith(testReleaseName)
      )
    ).toBe(true);
  }, 180000); // Increase timeout to 180s for the entire lifecycle test
});
