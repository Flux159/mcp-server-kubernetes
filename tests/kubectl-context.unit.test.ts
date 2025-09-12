import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { kubectlContext } from "../src/tools/kubectl-context.js";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";
import { execFileSync } from "child_process";

/**
 * Unit tests for kubectl context parsing functionality
 * 
 * These tests specifically address PR #200: Fix kubectl context parsing for context names with special characters
 * 
 * Background:
 * - The kubectl_context tool was incorrectly parsing context names containing special characters like colons (:) and at symbols (@)
 * - Only the currently active context would display its full name correctly
 * - Inactive contexts would show only partial names (cluster names instead of full context names)
 * - The fix replaced content-dependent split() approach with position-based parsing using substring()
 * 
 * Test Strategy:
 * - Mock execFileSync to control kubectl output exactly
 * - Test the specific scenarios described in PR #200
 * - Verify both the original problem case and edge cases
 * - Ensure backward compatibility with simple context names
 */

// Mock execFileSync for controlled testing
vi.mock("child_process", () => ({
    execFileSync: vi.fn(),
}));

// Mock KubernetesManager
const mockK8sManager = {} as KubernetesManager;

describe("kubectl context parsing - special characters fix (PR #200)", () => {
    const mockedExecFileSync = vi.mocked(execFileSync);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Test case: The original problem scenario from PR #200
     * 
     * Before fix: Inactive contexts showed cluster names instead of full context names
     * After fix: All contexts show their full names regardless of active status
     */
    test("should correctly parse the original PR #200 problem scenario", async () => {
        // This is the exact scenario described in PR #200
        const mockOutput = `CURRENT   NAME                         CLUSTER      AUTHINFO                     NAMESPACE
          sre:srereadonly@elegang      elegang      elegang:sre:srereadonly      sre
          sre:srereadonly@ohio         ohio         ohio:sre:srereadonly         sre
*         sre:srereadonly@wuxi         wuxi         wuxi:sre:srereadonly         sre`;

        mockedExecFileSync.mockReturnValue(mockOutput);

        const result = await kubectlContext(mockK8sManager, {
            operation: "list",
            output: "json",
        });

        const responseData = JSON.parse(result.content[0].text);
        const contexts = responseData.contexts;

        expect(contexts).toHaveLength(3);

        // Test the key fix: inactive contexts should show full names, not cluster names
        expect(contexts[0].name).toBe("sre:srereadonly@elegang"); // NOT "elegang"
        expect(contexts[0].cluster).toBe("elegang");
        expect(contexts[0].isCurrent).toBe(false);

        expect(contexts[1].name).toBe("sre:srereadonly@ohio"); // NOT "ohio"
        expect(contexts[1].cluster).toBe("ohio");
        expect(contexts[1].isCurrent).toBe(false);

        // Active context should work as before (this was already working)
        expect(contexts[2].name).toBe("sre:srereadonly@wuxi");
        expect(contexts[2].cluster).toBe("wuxi");
        expect(contexts[2].isCurrent).toBe(true);

        // Verify exactly one context is marked as current
        const currentContexts = contexts.filter((ctx: any) => ctx.isCurrent);
        expect(currentContexts).toHaveLength(1);
    });

    /**
     * Test case: Various special character combinations
     * Ensures the fix works with different patterns of special characters
     */
    test("should handle various special character patterns in context names", async () => {
        const mockOutput = `CURRENT   NAME                              CLUSTER           AUTHINFO                          NAMESPACE
*         user:admin@prod-cluster           prod-cluster      prod-cluster:user:admin           production
          dev:developer@staging-env         staging-env       staging-env:dev:developer         staging
          test@simple-cluster               simple-cluster    simple-cluster:test               default
          complex:role:name@multi-cluster   multi-cluster     multi-cluster:complex:role:name   development`;

        mockedExecFileSync.mockReturnValue(mockOutput);

        const result = await kubectlContext(mockK8sManager, {
            operation: "list",
            output: "json",
        });

        const responseData = JSON.parse(result.content[0].text);
        const contexts = responseData.contexts;

        expect(contexts).toHaveLength(4);

        // Test context with multiple colons and @ symbol
        expect(contexts[0].name).toBe("user:admin@prod-cluster");
        expect(contexts[0].cluster).toBe("prod-cluster");
        expect(contexts[0].isCurrent).toBe(true);

        // Test context with colon and @ in middle
        expect(contexts[1].name).toBe("dev:developer@staging-env");
        expect(contexts[1].cluster).toBe("staging-env");
        expect(contexts[1].isCurrent).toBe(false);

        // Test context with @ symbol only
        expect(contexts[2].name).toBe("test@simple-cluster");
        expect(contexts[2].cluster).toBe("simple-cluster");
        expect(contexts[2].isCurrent).toBe(false);

        // Test context with multiple colons
        expect(contexts[3].name).toBe("complex:role:name@multi-cluster");
        expect(contexts[3].cluster).toBe("multi-cluster");
        expect(contexts[3].isCurrent).toBe(false);
    });

    /**
     * Test case: Edge case - empty namespace handling
     * Verifies that contexts with missing namespace are handled correctly
     */
    test("should handle contexts with missing namespace", async () => {
        const mockOutput = `CURRENT   NAME                         CLUSTER      AUTHINFO                     NAMESPACE
          sre:admin@cluster-a          cluster-a    cluster-a:sre:admin          
*         sre:user@cluster-b           cluster-b    cluster-b:sre:user           development`;

        mockedExecFileSync.mockReturnValue(mockOutput);

        const result = await kubectlContext(mockK8sManager, {
            operation: "list",
            output: "json",
        });

        const responseData = JSON.parse(result.content[0].text);
        const contexts = responseData.contexts;

        expect(contexts).toHaveLength(2);

        // Test context with empty namespace (should default to "default")
        expect(contexts[0].name).toBe("sre:admin@cluster-a");
        expect(contexts[0].namespace).toBe("default");
        expect(contexts[0].isCurrent).toBe(false);

        // Test context with explicit namespace
        expect(contexts[1].name).toBe("sre:user@cluster-b");
        expect(contexts[1].namespace).toBe("development");
        expect(contexts[1].isCurrent).toBe(true);
    });

    /**
     * Test case: Error handling for malformed output
     * Ensures appropriate errors are thrown when kubectl output format is invalid
     */
    test("should throw error when required columns are missing", async () => {
        const mockOutput = `INVALID   HEADER                       FORMAT
          some-context                 some-cluster`;

        mockedExecFileSync.mockReturnValue(mockOutput);

        await expect(
            kubectlContext(mockK8sManager, {
                operation: "list",
                output: "json",
            })
        ).rejects.toThrow("Invalid kubectl output format");
    });

    /**
     * Test case: Backward compatibility
     * Ensures the fix doesn't break parsing of simple context names without special characters
     */
    test("should maintain backward compatibility with simple context names", async () => {
        const mockOutput = `CURRENT   NAME          CLUSTER       AUTHINFO      NAMESPACE
*         minikube      minikube      minikube      default
          docker        docker        docker        kube-system`;

        mockedExecFileSync.mockReturnValue(mockOutput);

        const result = await kubectlContext(mockK8sManager, {
            operation: "list",
            output: "json",
        });

        const responseData = JSON.parse(result.content[0].text);
        const contexts = responseData.contexts;

        expect(contexts).toHaveLength(2);

        // Simple context names should work exactly as before
        expect(contexts[0].name).toBe("minikube");
        expect(contexts[0].cluster).toBe("minikube");
        expect(contexts[0].isCurrent).toBe(true);

        expect(contexts[1].name).toBe("docker");
        expect(contexts[1].cluster).toBe("docker");
        expect(contexts[1].isCurrent).toBe(false);
    });

    /**
     * Test case: Empty line handling
     * Verifies that empty lines in kubectl output are properly skipped
     */
    test("should skip empty lines in kubectl output", async () => {
        const mockOutput = `CURRENT   NAME                         CLUSTER      AUTHINFO                     NAMESPACE
          context:one@cluster          cluster      cluster:context:one          namespace1

*         context:two@cluster          cluster      cluster:context:two          namespace2`;

        mockedExecFileSync.mockReturnValue(mockOutput);

        const result = await kubectlContext(mockK8sManager, {
            operation: "list",
            output: "json",
        });

        const responseData = JSON.parse(result.content[0].text);
        const contexts = responseData.contexts;

        // Should only have 2 contexts, empty line should be skipped
        expect(contexts).toHaveLength(2);

        expect(contexts[0].name).toBe("context:one@cluster");
        expect(contexts[0].isCurrent).toBe(false);

        expect(contexts[1].name).toBe("context:two@cluster");
        expect(contexts[1].isCurrent).toBe(true);
    });

    /**
     * Test case: Real-world AWS EKS context format
     * Tests common enterprise context naming patterns
     */
    test("should handle AWS EKS-style context names", async () => {
        const mockOutput = `CURRENT   NAME                                                          CLUSTER                    AUTHINFO                                                      NAMESPACE
          arn:aws:eks:us-west-2:123456789:cluster/prod-cluster          prod-cluster               arn:aws:eks:us-west-2:123456789:cluster/prod-cluster          default
*         arn:aws:eks:us-east-1:123456789:cluster/staging-cluster       staging-cluster            arn:aws:eks:us-east-1:123456789:cluster/staging-cluster       development`;

        mockedExecFileSync.mockReturnValue(mockOutput);

        const result = await kubectlContext(mockK8sManager, {
            operation: "list",
            output: "json",
        });

        const responseData = JSON.parse(result.content[0].text);
        const contexts = responseData.contexts;

        expect(contexts).toHaveLength(2);

        // AWS EKS context names should be preserved completely
        expect(contexts[0].name).toBe("arn:aws:eks:us-west-2:123456789:cluster/prod-cluster");
        expect(contexts[0].cluster).toBe("prod-cluster");
        expect(contexts[0].isCurrent).toBe(false);

        expect(contexts[1].name).toBe("arn:aws:eks:us-east-1:123456789:cluster/staging-cluster");
        expect(contexts[1].cluster).toBe("staging-cluster");
        expect(contexts[1].isCurrent).toBe(true);
    });
});
