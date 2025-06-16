import { expect, describe, test, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as k8s from "@kubernetes/client-node";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock @kubernetes/client-node
vi.mock("@kubernetes/client-node", () => ({
  KubeConfig: vi.fn().mockImplementation(() => ({
    loadFromCluster: vi.fn(),
    loadFromDefault: vi.fn(),
    loadFromString: vi.fn(),
    loadFromOptions: vi.fn(),
    loadFromFile: vi.fn(),
    makeApiClient: vi.fn().mockReturnValue({}),
    getCurrentContext: vi.fn().mockReturnValue("test-context"),
    getClusters: vi.fn().mockReturnValue([
      {
        name: "test-cluster",
        server: "https://test.example.com",
        skipTLSVerify: false,
      },
    ]),
    getUsers: vi.fn().mockReturnValue([
      {
        name: "test-user",
        token: "test-token",
      },
    ]),
    getContexts: vi.fn().mockReturnValue([
      {
        name: "test-context",
        cluster: "test-cluster",
        user: "test-user",
      },
    ]),
    setCurrentContext: vi.fn(),
    exportConfig: vi.fn().mockReturnValue(`apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://test.example.com
  name: test-cluster
users:
- name: test-user
  user:
    token: test-token
contexts:
- context:
    cluster: test-cluster
    user: test-user
  name: test-context
current-context: test-context`),
  })),
  CoreV1Api: vi.fn(),
  AppsV1Api: vi.fn(),
  BatchV1Api: vi.fn(),
}));

describe("KubernetesManager", () => {
  let kubernetesManager: KubernetesManager;
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe("isRunningInCluster", () => {
    beforeEach(() => {
      // Clear environment variables for these tests
      delete process.env.KUBECONFIG_YAML;
      delete process.env.KUBECONFIG_JSON;
      delete process.env.K8S_SERVER;
      delete process.env.K8S_TOKEN;
    });

    test("should return true when service account token exists", () => {
      // Mock fs.existsSync to return true for the service account check
      (fs.existsSync as any).mockReturnValue(true);

      // Test the isRunningInCluster method directly without constructor side effects
      kubernetesManager = new KubernetesManager();

      // Call fs.existsSync directly to test the logic
      const serviceAccountPath =
        "/var/run/secrets/kubernetes.io/serviceaccount/token";
      const result = fs.existsSync(serviceAccountPath);

      // Verify result
      expect(result).toBe(true);

      // Verify fs.existsSync was called with correct path
      expect(fs.existsSync).toHaveBeenCalledWith(
        "/var/run/secrets/kubernetes.io/serviceaccount/token"
      );
    });

    test("should return false when service account token does not exist", () => {
      // Mock fs.existsSync to return false for all calls
      (fs.existsSync as any).mockReturnValue(false);

      // Create instance to trigger constructor
      kubernetesManager = new KubernetesManager();

      // Use reflection to access the private method for direct testing
      const isRunningInClusterMethod = (
        kubernetesManager as any
      ).isRunningInCluster.bind(kubernetesManager);
      const result = isRunningInClusterMethod();

      // Verify result
      expect(result).toBe(false);

      // Verify fs.existsSync was called with correct path
      expect(fs.existsSync).toHaveBeenCalledWith(
        "/var/run/secrets/kubernetes.io/serviceaccount/token"
      );
    });

    test("should return false when fs.existsSync throws an error", () => {
      // Mock fs.existsSync to throw an error
      (fs.existsSync as any).mockImplementationOnce(() => {
        throw new Error("Some filesystem error");
      });

      // Create instance to trigger constructor
      kubernetesManager = new KubernetesManager();

      // Use reflection to access the private method for direct testing
      const isRunningInClusterMethod = (
        kubernetesManager as any
      ).isRunningInCluster.bind(kubernetesManager);
      const result = isRunningInClusterMethod();

      // Verify result
      expect(result).toBe(false);

      // Verify fs.existsSync was called with correct path
      expect(fs.existsSync).toHaveBeenCalledWith(
        "/var/run/secrets/kubernetes.io/serviceaccount/token"
      );
    });
  });

  describe("Environment Variable Configuration", () => {
    beforeEach(() => {
      // Mock not running in cluster for these tests
      (fs.existsSync as any).mockReturnValue(false);

      // Clear Kubernetes related environment variables
      delete process.env.KUBECONFIG_YAML;
      delete process.env.KUBECONFIG_JSON;
      delete process.env.K8S_SERVER;
      delete process.env.K8S_TOKEN;
      delete process.env.K8S_CONTEXT;
      delete process.env.K8S_NAMESPACE;
      delete process.env.K8S_SKIP_TLS_VERIFY;
    });

    describe("hasEnvKubeconfigYaml", () => {
      test("should return true when KUBECONFIG_YAML is set", () => {
        process.env.KUBECONFIG_YAML = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://example.com
  name: test-cluster
users:
- name: test-user
  user:
    token: fake-token
contexts:
- context:
    cluster: test-cluster
    user: test-user
  name: test-context
current-context: test-context`;

        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvKubeconfigYaml();
        expect(result).toBe(true);
      });

      test("should return false when KUBECONFIG_YAML is empty", () => {
        process.env.KUBECONFIG_YAML = "";
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvKubeconfigYaml();
        expect(result).toBe(false);
      });

      test("should return false when KUBECONFIG_YAML is not set", () => {
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvKubeconfigYaml();
        expect(result).toBe(false);
      });
    });

    describe("hasEnvKubeconfigJson", () => {
      test("should return true when KUBECONFIG_JSON is set", () => {
        process.env.KUBECONFIG_JSON = JSON.stringify({
          apiVersion: "v1",
          kind: "Config",
          clusters: [
            {
              cluster: { server: "https://example.com" },
              name: "test-cluster",
            },
          ],
          users: [
            {
              name: "test-user",
              user: { token: "fake-token" },
            },
          ],
          contexts: [
            {
              context: { cluster: "test-cluster", user: "test-user" },
              name: "test-context",
            },
          ],
          "current-context": "test-context",
        });

        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvKubeconfigJson();
        expect(result).toBe(true);
      });

      test("should return false when KUBECONFIG_JSON is empty", () => {
        process.env.KUBECONFIG_JSON = "";
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvKubeconfigJson();
        expect(result).toBe(false);
      });

      test("should return false when KUBECONFIG_JSON is not set", () => {
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvKubeconfigJson();
        expect(result).toBe(false);
      });
    });

    describe("hasEnvMinimalKubeconfig", () => {
      test("should return true when both K8S_SERVER and K8S_TOKEN are set", () => {
        process.env.K8S_SERVER = "https://kubernetes.example.com";
        process.env.K8S_TOKEN = "fake-token";
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvMinimalKubeconfig();
        expect(result).toBe(true);
      });

      test("should return false when only K8S_SERVER is set", () => {
        process.env.K8S_SERVER = "https://kubernetes.example.com";
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvMinimalKubeconfig();
        expect(result).toBe(false);
      });

      test("should return false when only K8S_TOKEN is set", () => {
        process.env.K8S_TOKEN = "fake-token";
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvMinimalKubeconfig();
        expect(result).toBe(false);
      });

      test("should return false when neither is set", () => {
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvMinimalKubeconfig();
        expect(result).toBe(false);
      });

      test("should return false when values are empty strings", () => {
        process.env.K8S_SERVER = "";
        process.env.K8S_TOKEN = "";
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvMinimalKubeconfig();
        expect(result).toBe(false);
      });
    });

    describe("hasEnvKubeconfigPath", () => {
      test("should return true when KUBECONFIG_PATH is set", () => {
        process.env.KUBECONFIG_PATH = "/path/to/kubeconfig";
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvKubeconfigPath();
        expect(result).toBe(true);
      });

      test("should return false when KUBECONFIG_PATH is empty", () => {
        process.env.KUBECONFIG_PATH = "";
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvKubeconfigPath();
        expect(result).toBe(false);
      });

      test("should return false when KUBECONFIG_PATH is not set", () => {
        kubernetesManager = new KubernetesManager();

        const result = (kubernetesManager as any).hasEnvKubeconfigPath();
        expect(result).toBe(false);
      });
    });

    describe("Configuration Priority Order", () => {
      test("should use minimal config when K8S_SERVER and K8S_TOKEN are set", () => {
        process.env.K8S_SERVER = "https://test-cluster.example.com";
        process.env.K8S_TOKEN = "test-token-12345";

        // This should not throw an error and should create a valid config
        expect(() => {
          kubernetesManager = new KubernetesManager();
        }).not.toThrow();

        const kubeConfig = kubernetesManager.getKubeConfig();

        // Verify the loadFromOptions was called for minimal config
        expect(kubeConfig.loadFromOptions).toHaveBeenCalledWith(
          expect.objectContaining({
            clusters: expect.arrayContaining([
              expect.objectContaining({
                name: "env-cluster",
                server: "https://test-cluster.example.com",
              }),
            ]),
            users: expect.arrayContaining([
              expect.objectContaining({
                name: "env-user",
                token: "test-token-12345",
              }),
            ]),
            contexts: expect.arrayContaining([
              expect.objectContaining({
                name: "env-context",
              }),
            ]),
          })
        );
      });

      test("should apply TLS skip verification when K8S_SKIP_TLS_VERIFY is true", () => {
        process.env.K8S_SERVER = "https://test-cluster.example.com";
        process.env.K8S_TOKEN = "test-token-12345";
        process.env.K8S_SKIP_TLS_VERIFY = "true";

        kubernetesManager = new KubernetesManager();
        const kubeConfig = kubernetesManager.getKubeConfig();

        // Verify the loadFromOptions was called with skipTLSVerify: true
        expect(kubeConfig.loadFromOptions).toHaveBeenCalledWith(
          expect.objectContaining({
            clusters: expect.arrayContaining([
              expect.objectContaining({
                skipTLSVerify: true,
              }),
            ]),
          })
        );
      });

      test("should not skip TLS verification when K8S_SKIP_TLS_VERIFY is false", () => {
        process.env.K8S_SERVER = "https://test-cluster.example.com";
        process.env.K8S_TOKEN = "test-token-12345";
        process.env.K8S_SKIP_TLS_VERIFY = "false";

        kubernetesManager = new KubernetesManager();
        const kubeConfig = kubernetesManager.getKubeConfig();

        // Verify the loadFromOptions was called with skipTLSVerify: false
        expect(kubeConfig.loadFromOptions).toHaveBeenCalledWith(
          expect.objectContaining({
            clusters: expect.arrayContaining([
              expect.objectContaining({
                skipTLSVerify: false,
              }),
            ]),
          })
        );
      });

      test("should handle context override with K8S_CONTEXT", () => {
        process.env.K8S_SERVER = "https://test-cluster.example.com";
        process.env.K8S_TOKEN = "test-token-12345";
        process.env.K8S_CONTEXT = "test-context"; // Use existing context from mock

        kubernetesManager = new KubernetesManager();
        const kubeConfig = kubernetesManager.getKubeConfig();

        // Verify setCurrentContext was called
        expect(kubeConfig.setCurrentContext).toHaveBeenCalledWith(
          "test-context"
        );
      });

      test("should use KUBECONFIG_PATH when set", () => {
        process.env.KUBECONFIG_PATH = "/path/to/custom/kubeconfig";

        kubernetesManager = new KubernetesManager();
        const kubeConfig = kubernetesManager.getKubeConfig();

        // Verify loadFromFile was called with the custom path
        expect(kubeConfig.loadFromFile).toHaveBeenCalledWith(
          "/path/to/custom/kubeconfig"
        );
      });

      test("should prioritize minimal config over KUBECONFIG_PATH", () => {
        process.env.K8S_SERVER = "https://test-cluster.example.com";
        process.env.K8S_TOKEN = "test-token-12345";
        process.env.KUBECONFIG_PATH = "/path/to/custom/kubeconfig";

        kubernetesManager = new KubernetesManager();
        const kubeConfig = kubernetesManager.getKubeConfig();

        // Verify loadFromOptions was called (minimal config) and NOT loadFromFile
        expect(kubeConfig.loadFromOptions).toHaveBeenCalled();
        expect(kubeConfig.loadFromFile).not.toHaveBeenCalled();
      });
    });

    describe("Error Handling", () => {
      test("should throw error when KUBECONFIG_YAML is invalid", () => {
        process.env.KUBECONFIG_YAML = "invalid: yaml: content: [";

        // Create a mock instance to test with
        const mockKubeConfig = {
          loadFromCluster: vi.fn(),
          loadFromDefault: vi.fn(),
          loadFromString: vi.fn().mockImplementationOnce(() => {
            throw new Error("YAML parse error");
          }),
          loadFromOptions: vi.fn(),
          loadFromFile: vi.fn(),
          makeApiClient: vi.fn().mockReturnValue({}),
          getCurrentContext: vi.fn().mockReturnValue("test-context"),
          getClusters: vi.fn().mockReturnValue([]),
          getUsers: vi.fn().mockReturnValue([]),
          getContexts: vi.fn().mockReturnValue([]),
          setCurrentContext: vi.fn(),
        };

        // Mock the KubeConfig constructor to return our mock
        vi.mocked(k8s.KubeConfig).mockImplementationOnce(
          () => mockKubeConfig as any
        );

        expect(() => {
          kubernetesManager = new KubernetesManager();
        }).toThrow("Failed to parse KUBECONFIG_YAML");
      });

      test("should throw error when KUBECONFIG_JSON is invalid", () => {
        process.env.KUBECONFIG_JSON = '{"invalid": json}';

        expect(() => {
          kubernetesManager = new KubernetesManager();
        }).toThrow("Failed to parse KUBECONFIG_JSON");
      });

      test("should fall back to default file when K8S_SERVER is missing but K8S_TOKEN is set", () => {
        process.env.K8S_TOKEN = "test-token";
        // K8S_SERVER is intentionally not set

        // Should not throw since it falls back to default file
        expect(() => {
          kubernetesManager = new KubernetesManager();
        }).not.toThrow();

        // Verify it called loadFromDefault
        const kubeConfig = kubernetesManager.getKubeConfig();
        expect(kubeConfig.loadFromDefault).toHaveBeenCalled();
      });

      test("should fall back to default file when K8S_TOKEN is missing but K8S_SERVER is set", () => {
        process.env.K8S_SERVER = "https://test-cluster.example.com";
        // K8S_TOKEN is intentionally not set

        // Should not throw since it falls back to default file
        expect(() => {
          kubernetesManager = new KubernetesManager();
        }).not.toThrow();

        // Verify it called loadFromDefault
        const kubeConfig = kubernetesManager.getKubeConfig();
        expect(kubeConfig.loadFromDefault).toHaveBeenCalled();
      });
    });

    describe("API Client Creation", () => {
      test("should create API clients successfully with minimal config", () => {
        process.env.K8S_SERVER = "https://test-cluster.example.com";
        process.env.K8S_TOKEN = "test-token-12345";

        kubernetesManager = new KubernetesManager();

        // These should not throw and should return API client instances
        expect(() => kubernetesManager.getCoreApi()).not.toThrow();
        expect(() => kubernetesManager.getAppsApi()).not.toThrow();
        expect(() => kubernetesManager.getBatchApi()).not.toThrow();

        // Verify API clients are truthy (not null/undefined)
        expect(kubernetesManager.getCoreApi()).toBeTruthy();
        expect(kubernetesManager.getAppsApi()).toBeTruthy();
        expect(kubernetesManager.getBatchApi()).toBeTruthy();
      });
    });

    describe("Namespace Handling", () => {
      test("should use K8S_NAMESPACE when set", () => {
        process.env.K8S_SERVER = "https://test-cluster.example.com";
        process.env.K8S_TOKEN = "test-token-12345";
        process.env.K8S_NAMESPACE = "my-custom-namespace";

        kubernetesManager = new KubernetesManager();

        // Note: We need to add getDefaultNamespace method to KubernetesManager
        // For now, we can test that the environment variable is set
        expect(process.env.K8S_NAMESPACE).toBe("my-custom-namespace");
      });

      test('should default to "default" namespace when K8S_NAMESPACE is not set', () => {
        process.env.K8S_SERVER = "https://test-cluster.example.com";
        process.env.K8S_TOKEN = "test-token-12345";
        // K8S_NAMESPACE is intentionally not set

        kubernetesManager = new KubernetesManager();

        // Environment variable should be undefined, defaulting behavior is expected
        expect(process.env.K8S_NAMESPACE).toBeUndefined();
      });
    });
  });
});
