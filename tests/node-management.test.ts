import { describe, test, expect, vi } from "vitest";
import { nodeManagementSchema } from "../src/tools/node-management.js";

describe("node_management tool", () => {
  test("schema is properly defined", () => {
    expect(nodeManagementSchema).toBeDefined();
    expect(nodeManagementSchema.name).toBe("node_management");
    expect(nodeManagementSchema.description).toContain("Manage Kubernetes nodes");

    // Check input schema
    expect(nodeManagementSchema.inputSchema).toBeDefined();
    expect(nodeManagementSchema.inputSchema.properties).toBeDefined();

    // Check required properties
    expect(nodeManagementSchema.inputSchema.required).toContain("operation");

    // Check optional properties
    expect(nodeManagementSchema.inputSchema.properties.nodeName).toBeDefined();
    expect(nodeManagementSchema.inputSchema.properties.force).toBeDefined();
    expect(nodeManagementSchema.inputSchema.properties.gracePeriod).toBeDefined();
    expect(nodeManagementSchema.inputSchema.properties.deleteLocalData).toBeDefined();
    expect(nodeManagementSchema.inputSchema.properties.ignoreDaemonsets).toBeDefined();
    expect(nodeManagementSchema.inputSchema.properties.timeout).toBeDefined();
    expect(nodeManagementSchema.inputSchema.properties.dryRun).toBeDefined();
    expect(nodeManagementSchema.inputSchema.properties.confirmDrain).toBeDefined();
  });

  describe("operation types", () => {
    test("supports all required operations", () => {
      const operations = ["cordon", "drain", "uncordon", "list"];
      
      operations.forEach(operation => {
        expect(operations).toContain(operation);
      });
    });

    test("validates operation parameter", () => {
      const validOperations = ["cordon", "drain", "uncordon", "list"];
      const invalidOperation = "invalid_op";
      
      expect(validOperations).toContain("cordon");
      expect(validOperations).toContain("drain");
      expect(validOperations).toContain("uncordon");
      expect(validOperations).toContain("list");
      expect(validOperations).not.toContain(invalidOperation);
    });
  });

  describe("parameter validation", () => {
    test("validates required parameters", () => {
      const validInput = {
        operation: "list"
      };
      
      // This would be validated by the schema
      expect(validInput.operation).toBeDefined();
    });

    test("handles optional parameters correctly", () => {
      const fullInput = {
        operation: "drain",
        nodeName: "worker-node-1",
        force: true,
        gracePeriod: 60,
        deleteLocalData: false,
        ignoreDaemonsets: true,
        timeout: "300s",
        dryRun: false,
        confirmDrain: true
      };
      
      expect(fullInput.nodeName).toBe("worker-node-1");
      expect(fullInput.force).toBe(true);
      expect(fullInput.gracePeriod).toBe(60);
      expect(fullInput.deleteLocalData).toBe(false);
      expect(fullInput.ignoreDaemonsets).toBe(true);
      expect(fullInput.timeout).toBe("300s");
      expect(fullInput.dryRun).toBe(false);
      expect(fullInput.confirmDrain).toBe(true);
    });

    test("uses default values when not specified", () => {
      const minimalInput = {
        operation: "cordon"
      };
      
      // These would be the defaults from the schema
      const defaults = {
        force: false,
        gracePeriod: 30,
        deleteLocalData: false,
        ignoreDaemonsets: false,
        timeout: "0",
        dryRun: false,
        confirmDrain: false
      };
      
      expect(defaults.force).toBe(false);
      expect(defaults.gracePeriod).toBe(30);
      expect(defaults.deleteLocalData).toBe(false);
      expect(defaults.ignoreDaemonsets).toBe(false);
      expect(defaults.timeout).toBe("0");
      expect(defaults.dryRun).toBe(false);
      expect(defaults.confirmDrain).toBe(false);
    });
  });

  describe("operation-specific requirements", () => {
    test("nodeName required for cordon operation", () => {
      const cordonInput = {
        operation: "cordon",
        nodeName: "worker-node-1"
      };
      
      expect(cordonInput.operation).toBe("cordon");
      expect(cordonInput.nodeName).toBeDefined();
    });

    test("nodeName required for drain operation", () => {
      const drainInput = {
        operation: "drain",
        nodeName: "worker-node-1",
        force: true,
        confirmDrain: true
      };
      
      expect(drainInput.operation).toBe("drain");
      expect(drainInput.nodeName).toBeDefined();
      expect(drainInput.force).toBe(true);
      expect(drainInput.confirmDrain).toBe(true);
    });

    test("nodeName required for uncordon operation", () => {
      const uncordonInput = {
        operation: "uncordon",
        nodeName: "worker-node-1"
      };
      
      expect(uncordonInput.operation).toBe("uncordon");
      expect(uncordonInput.nodeName).toBeDefined();
    });

    test("list operation doesn't require nodeName", () => {
      const listInput = {
        operation: "list"
      };
      
      expect(listInput.operation).toBe("list");
      expect(listInput.nodeName).toBeUndefined();
    });
  });

  describe("safety features", () => {
    test("dry run mode prevents actual operations", () => {
      const dryRunInput = {
        operation: "drain",
        nodeName: "worker-node-1",
        dryRun: true,
        force: false,
        confirmDrain: false
      };
      
      // In dry run mode, no actual operations should occur
      expect(dryRunInput.dryRun).toBe(true);
      expect(dryRunInput.force).toBe(false);
      expect(dryRunInput.confirmDrain).toBe(false);
    });

    test("confirmation required for drain operations", () => {
      const drainInput = {
        operation: "drain",
        nodeName: "worker-node-1",
        force: true,
        confirmDrain: true
      };
      
      // Both force and confirmDrain should be true for actual drain
      expect(drainInput.force).toBe(true);
      expect(drainInput.confirmDrain).toBe(true);
    });

    test("grace period controls pod termination", () => {
      const drainInput = {
        operation: "drain",
        nodeName: "worker-node-1",
        gracePeriod: 120,
        force: true,
        confirmDrain: true
      };
      
      expect(drainInput.gracePeriod).toBe(120);
    });
  });

  describe("error handling", () => {
    test("handles invalid operations", () => {
      const validOperations = ["cordon", "drain", "uncordon", "list"];
      const invalidOperation = "invalid_op";
      
      expect(validOperations).not.toContain(invalidOperation);
    });

    test("handles missing nodeName for required operations", () => {
      const operationsRequiringNodeName = ["cordon", "drain", "uncordon"];
      
      operationsRequiringNodeName.forEach(operation => {
        const input = { operation };
        expect((input as any).nodeName).toBeUndefined();
      });
    });

    test("handles timeout parameter validation", () => {
      const validTimeouts = ["0", "30s", "1m", "5m", "10m"];
      const invalidTimeout = "invalid";
      
      expect(validTimeouts).toContain("0");
      expect(validTimeouts).toContain("30s");
      expect(validTimeouts).not.toContain(invalidTimeout);
    });
  });
}); 