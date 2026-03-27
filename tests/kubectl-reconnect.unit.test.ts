import { expect, test, describe, vi, beforeEach } from "vitest";
import { kubectlReconnect } from "../src/tools/kubectl-reconnect.js";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

describe("kubectl_reconnect tool", () => {
  let mockK8sManager: Partial<KubernetesManager>;

  beforeEach(() => {
    mockK8sManager = {
      refreshApiClients: vi.fn(),
    };
  });

  test("should call refreshApiClients and return success response", async () => {
    const result = await kubectlReconnect(
      mockK8sManager as KubernetesManager
    );

    expect(mockK8sManager.refreshApiClients).toHaveBeenCalledOnce();

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData.success).toBe(true);
    expect(responseData.message).toContain("DNS will be re-resolved");
  });

  test("should throw McpError when refreshApiClients throws", async () => {
    vi.mocked(mockK8sManager.refreshApiClients!).mockImplementation(() => {
      throw new Error("connection reset");
    });

    await expect(
      kubectlReconnect(mockK8sManager as KubernetesManager)
    ).rejects.toThrow(McpError);

    await expect(
      kubectlReconnect(mockK8sManager as KubernetesManager)
    ).rejects.toThrow("Failed to reconnect: connection reset");
  });
});
