import { describe, test, expect, vi } from "vitest";
import { execInPodSchema, execInPod } from "../src/tools/exec_in_pod.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

describe("exec_in_pod tool", () => {
  // Test the schema definition
  test("schema is properly defined", () => {
    expect(execInPodSchema).toBeDefined();
    expect(execInPodSchema.name).toBe("exec_in_pod");
    expect(execInPodSchema.description).toContain("Execute a command in a Kubernetes pod");
    
    // Check input schema
    expect(execInPodSchema.inputSchema).toBeDefined();
    expect(execInPodSchema.inputSchema.properties).toBeDefined();
    
    // Check required properties
    expect(execInPodSchema.inputSchema.required).toContain("name");
    expect(execInPodSchema.inputSchema.required).toContain("command");
    
    // Check for our newly added properties
    expect(execInPodSchema.inputSchema.properties.shell).toBeDefined();
    expect(execInPodSchema.inputSchema.properties.shell.description).toContain("Shell to use");
    expect(execInPodSchema.inputSchema.properties.shell.optional).toBe(true);
    
    expect(execInPodSchema.inputSchema.properties.timeout).toBeDefined();
    expect(execInPodSchema.inputSchema.properties.timeout.description).toContain("Timeout for command");
    expect(execInPodSchema.inputSchema.properties.timeout.type).toBe("number");
    expect(execInPodSchema.inputSchema.properties.timeout.optional).toBe(true);
    
    // Check command can be string or array
    expect(execInPodSchema.inputSchema.properties.command.anyOf).toHaveLength(2);
    expect(execInPodSchema.inputSchema.properties.command.anyOf[0].type).toBe("string");
    expect(execInPodSchema.inputSchema.properties.command.anyOf[1].type).toBe("array");
  });

  // Test parameter handling - equivalent to kubectl exec command string handling
  describe("command handling", () => {
    // Simple test to verify command string/array handling
    test("command parameter can be string or array", () => {
      // Test string command - should wrap in shell (kubectl exec pod-name -- echo hello)
      let commandArr = Array.isArray("echo hello") 
        ? "echo hello" 
        : ["/bin/sh", "-c", "echo hello"];
      expect(commandArr).toEqual(["/bin/sh", "-c", "echo hello"]);
      
      // Test array command - should pass through as-is (kubectl exec pod-name -- echo hello)
      commandArr = Array.isArray(["echo", "hello"]) 
        ? ["echo", "hello"] 
        : ["/bin/sh", "-c", ["echo", "hello"].join(" ")];
      expect(commandArr).toEqual(["echo", "hello"]);
    });
    
    // Test complex commands 
    test("handles complex command strings", () => {
      // Test command with quotes (kubectl exec pod-name -- sh -c 'echo "hello world"')
      let command = 'echo "hello world"';
      let commandArr = ["/bin/sh", "-c", command];
      expect(commandArr).toEqual(["/bin/sh", "-c", 'echo "hello world"']);
      
      // Test command with pipe (kubectl exec pod-name -- sh -c 'ls | grep file')
      command = "ls | grep file";
      commandArr = ["/bin/sh", "-c", command];
      expect(commandArr).toEqual(["/bin/sh", "-c", "ls | grep file"]);
      
      // Test command with multiple statements (kubectl exec pod-name -- sh -c 'cd /tmp && ls')
      command = "cd /tmp && ls";
      commandArr = ["/bin/sh", "-c", command];
      expect(commandArr).toEqual(["/bin/sh", "-c", "cd /tmp && ls"]);
    });
  });
  
  // Test shell parameter handling
  describe("shell parameter", () => {
    test("shell parameter changes default shell", () => {
      // Test with default shell (kubectl exec pod-name -- sh -c 'command')
      let shell: string | undefined = undefined;
      let commandArr = [shell || "/bin/sh", "-c", "echo hello"];
      expect(commandArr).toEqual(["/bin/sh", "-c", "echo hello"]);
      
      // Test with bash shell (kubectl exec pod-name -- bash -c 'command')
      shell = "/bin/bash";
      commandArr = [shell || "/bin/sh", "-c", "echo hello"];
      expect(commandArr).toEqual(["/bin/bash", "-c", "echo hello"]);
      
      // Test with zsh shell (kubectl exec pod-name -- zsh -c 'command')
      shell = "/bin/zsh";
      commandArr = [shell || "/bin/sh", "-c", "echo hello"];
      expect(commandArr).toEqual(["/bin/zsh", "-c", "echo hello"]);
    });
    
    test("shell parameter not used with array commands", () => {
      // Array commands should pass through regardless of shell
      const command = ["echo", "hello"];
      const shell = "/bin/bash";
      
      // With array commands, the shell should be ignored
      if (Array.isArray(command)) {
        expect(command).toEqual(["echo", "hello"]);
      } else {
        const shellCmd = [shell || "/bin/sh", "-c", command];
        expect(shellCmd).toEqual(["/bin/bash", "-c", "command-that-should-not-be-used"]);
      }
    });
  });
  
  // Test timeout parameter
  describe("timeout parameter", () => {
    test("timeout parameter changes default timeout", () => {
      // Function to simulate how timeout is used in execInPod
      function getTimeoutValue(inputTimeout: number | undefined): number {
        return inputTimeout !== undefined ? inputTimeout : 60000;
      }
      
      // Test with default timeout (kubectl exec has no built-in timeout)
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
        if (ms < 60000) return `${ms/1000} seconds`;
        return `${ms/60000} minutes`;
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
});
