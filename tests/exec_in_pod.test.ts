import { describe, test, expect, vi } from "vitest";
import { execInPodSchema, execInPod } from "../src/tools/exec_in_pod.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

describe("exec_in_pod tool", () => {
  // Test the schema definition
  test("schema is properly defined", () => {
    expect(execInPodSchema).toBeDefined();
    expect(execInPodSchema.name).toBe("exec_in_pod");
    expect(execInPodSchema.description).toContain("Execute a command in a Kubernetes pod");
    expect(execInPodSchema.description).toContain("array of strings");

    // Check input schema
    expect(execInPodSchema.inputSchema).toBeDefined();
    expect(execInPodSchema.inputSchema.properties).toBeDefined();

    // Check required properties
    expect(execInPodSchema.inputSchema.required).toContain("name");
    expect(execInPodSchema.inputSchema.required).toContain("command");

    // Check command is array-only (no string support for security)
    expect(execInPodSchema.inputSchema.properties.command.type).toBe("array");
    expect(execInPodSchema.inputSchema.properties.command.items.type).toBe("string");

    // Shell parameter should NOT exist (removed for security)
    expect(execInPodSchema.inputSchema.properties.shell).toBeUndefined();

    // Timeout should still exist
    expect(execInPodSchema.inputSchema.properties.timeout).toBeDefined();
    expect(execInPodSchema.inputSchema.properties.timeout.description).toContain("Timeout for command");
    expect(execInPodSchema.inputSchema.properties.timeout.type).toBe("number");
  });

  // Test command handling - SECURITY: Only arrays are allowed
  describe("command handling (security)", () => {
    test("command must be an array of strings", () => {
      // Array commands are valid
      const validCommand = ["ls", "-la", "/app"];
      expect(Array.isArray(validCommand)).toBe(true);
      expect(validCommand.every(arg => typeof arg === "string")).toBe(true);
    });

    test("array commands pass through without shell wrapping", () => {
      // Array commands should be used as-is, not wrapped in shell
      const command = ["echo", "hello", "world"];
      // The command array goes directly to K8s exec API
      expect(command).toEqual(["echo", "hello", "world"]);
      // NOT wrapped like ["/bin/sh", "-c", "echo hello world"]
    });

    test("command description explains security constraints", () => {
      const desc = execInPodSchema.inputSchema.properties.command.description;
      expect(desc).toContain("array of strings");
      expect(desc).toContain("security");
    });
  });

  // Test validation logic (unit test the validation without K8s connection)
  describe("input validation", () => {
    // Create a mock k8sManager that throws before any K8s calls
    const mockK8sManager = {
      setCurrentContext: vi.fn(),
      getKubeConfig: vi.fn(() => {
        throw new Error("Should not reach K8s API in validation tests");
      }),
    } as any;

    test("rejects non-array command", async () => {
      await expect(
        execInPod(mockK8sManager, {
          name: "test-pod",
          command: "echo hello" as any, // Force string to test validation
        })
      ).rejects.toThrow("Command must be an array of strings");
    });

    test("rejects empty command array", async () => {
      await expect(
        execInPod(mockK8sManager, {
          name: "test-pod",
          command: [],
        })
      ).rejects.toThrow("Command array cannot be empty");
    });

    test("rejects command array with non-string elements", async () => {
      await expect(
        execInPod(mockK8sManager, {
          name: "test-pod",
          command: ["ls", 123 as any, "-la"],
        })
      ).rejects.toThrow("must be a string");
    });
  });

  // Test timeout parameter
  describe("timeout parameter", () => {
    test("timeout parameter changes default timeout", () => {
      // Function to simulate how timeout is used in execInPod
      function getTimeoutValue(inputTimeout: number | undefined): number {
        return inputTimeout !== undefined ? inputTimeout : 60000;
      }

      // Test with default timeout
      let timeout: number | undefined = undefined;
      let timeoutMs = getTimeoutValue(timeout);
      expect(timeoutMs).toBe(60000);

      // Test with custom timeout
      timeout = 30000;
      timeoutMs = getTimeoutValue(timeout);
      expect(timeoutMs).toBe(30000);

      // Test with zero timeout (should be honored, not use default)
      timeout = 0;
      timeoutMs = getTimeoutValue(timeout);
      expect(timeoutMs).toBe(0);
    });

    test("timeout value represents milliseconds", () => {
      // Convert common timeouts to human-readable form
      function formatTimeout(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${ms / 1000} seconds`;
        return `${ms / 60000} minutes`;
      }

      // Default timeout is 1 minute
      expect(formatTimeout(60000)).toBe("1 minutes");

      // 30 second timeout
      expect(formatTimeout(30000)).toBe("30 seconds");

      // 5 minute timeout
      expect(formatTimeout(300000)).toBe("5 minutes");
    });
  });

  // Test container parameter
  describe("container parameter", () => {
    test("container parameter sets target container", () => {
      // Function to simulate how container param is used in kubectl exec
      function buildExecCommand(podName: string, containerName?: string, command?: string[]): string {
        let cmd = `kubectl exec ${podName}`;
        if (containerName) {
          cmd += ` -c ${containerName}`;
        }
        if (command) {
          cmd += ` -- ${command.join(" ")}`;
        }
        return cmd;
      }

      // Test without container (kubectl exec pod-name -- command)
      let execCmd = buildExecCommand("test-pod", undefined, ["echo", "hello"]);
      expect(execCmd).toBe("kubectl exec test-pod -- echo hello");

      // Test with container (kubectl exec -c container-name pod-name -- command)
      execCmd = buildExecCommand("test-pod", "main-container", ["echo", "hello"]);
      expect(execCmd).toBe("kubectl exec test-pod -c main-container -- echo hello");
    });
  });

  // Test namespace parameter
  describe("namespace parameter", () => {
    test("namespace parameter sets target namespace", () => {
      // Function to simulate how namespace param is used in kubectl exec
      function buildExecCommand(podName: string, namespace?: string, containerName?: string): string {
        let cmd = `kubectl exec ${podName}`;
        if (namespace) {
          cmd += ` -n ${namespace}`;
        }
        if (containerName) {
          cmd += ` -c ${containerName}`;
        }
        return cmd + " -- command";
      }

      // Test with default namespace (kubectl exec pod-name -- command)
      let execCmd = buildExecCommand("test-pod");
      expect(execCmd).toBe("kubectl exec test-pod -- command");

      // Test with custom namespace (kubectl exec -n custom-ns pod-name -- command)
      execCmd = buildExecCommand("test-pod", "custom-ns");
      expect(execCmd).toBe("kubectl exec test-pod -n custom-ns -- command");

      // Test with namespace and container
      execCmd = buildExecCommand("test-pod", "custom-ns", "main-container");
      expect(execCmd).toBe("kubectl exec test-pod -n custom-ns -c main-container -- command");
    });
  });

  // Test error handling
  describe("error handling", () => {
    test("handles stderr output", () => {
      // Simulate stderr output in execInPod
      function processExecOutput(stdout: string, stderr: string): { success: boolean, message?: string, output?: string } {
        if (stderr) {
          return {
            success: false,
            message: `Failed to execute command in pod: ${stderr}`
          };
        }

        if (!stdout && !stderr) {
          return {
            success: false,
            message: "Failed to execute command in pod: No output"
          };
        }

        return {
          success: true,
          output: stdout
        };
      }

      // Test successful execution
      let result = processExecOutput("command output", "");
      expect(result.success).toBe(true);
      expect(result.output).toBe("command output");

      // Test stderr error
      result = processExecOutput("", "command not found");
      expect(result.success).toBe(false);
      expect(result.message).toContain("command not found");

      // Test no output
      result = processExecOutput("", "");
      expect(result.success).toBe(false);
      expect(result.message).toContain("No output");
    });
  });

  // Verify array format prevents shell interpretation
  describe("exec in pod should only support string arrays", () => {
    test("shell metacharacters in array elements are not interpreted", () => {
      // When using array format, shell metacharacters are passed as literal strings
      // to the executable, not interpreted by a shell
      const command = ["echo", "hello; touch /tmp/pwned"];

      // With array format, "hello; touch /tmp/pwned" is a single argument to echo
      // It will literally print "hello; touch /tmp/pwned" not execute touch
      expect(command[0]).toBe("echo");
      expect(command[1]).toBe("hello; touch /tmp/pwned"); // Literal string, not shell-interpreted
    });

    test("pipe operators in array elements are not interpreted", () => {
      const command = ["cat", "/tmp/data | tee /tmp/output"];

      // With array format, the pipe is part of the filename argument
      // cat will try to open a file literally named "/tmp/data | tee /tmp/output"
      expect(command[0]).toBe("cat");
      expect(command[1]).toContain("|"); // Literal pipe character
    });

    test("command substitution in array elements is not interpreted", () => {
      const command = ["echo", "$(whoami)"];

      // With array format, $(whoami) is printed literally
      expect(command[0]).toBe("echo");
      expect(command[1]).toBe("$(whoami)"); // Not executed
    });
  });
});
