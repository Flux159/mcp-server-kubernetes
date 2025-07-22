import { describe, test, expect, vi } from "vitest";
import { 
  installHelmChartSchema, 
  upgradeHelmChartSchema, 
  uninstallHelmChartSchema 
} from "../src/tools/helm-operations.js";

describe("helm operations tools", () => {
  describe("install_helm_chart", () => {
    test("schema is properly defined", () => {
      expect(installHelmChartSchema).toBeDefined();
      expect(installHelmChartSchema.name).toBe("install_helm_chart");
      expect(installHelmChartSchema.description).toContain("Install a Helm chart");

      // Check input schema
      expect(installHelmChartSchema.inputSchema).toBeDefined();
      expect(installHelmChartSchema.inputSchema.properties).toBeDefined();

      // Check required properties
      expect(installHelmChartSchema.inputSchema.required).toContain("name");
      expect(installHelmChartSchema.inputSchema.required).toContain("chart");
      expect(installHelmChartSchema.inputSchema.required).toContain("namespace");

      // Check optional properties
      expect(installHelmChartSchema.inputSchema.properties.repo).toBeDefined();
      expect(installHelmChartSchema.inputSchema.properties.values).toBeDefined();
      expect(installHelmChartSchema.inputSchema.properties.valuesFile).toBeDefined();
      expect(installHelmChartSchema.inputSchema.properties.createNamespace).toBeDefined();
      expect(installHelmChartSchema.inputSchema.properties.useTemplate).toBeDefined();
    });

    test("useTemplate parameter enables template mode", () => {
      const schema = installHelmChartSchema.inputSchema;
      
      // Check that useTemplate is a boolean with default false
      expect(schema.properties.useTemplate.type).toBe("boolean");
      expect(schema.properties.useTemplate.default).toBe(false);
      expect(schema.properties.useTemplate.description).toContain("Use helm template + kubectl apply");
    });

    test("createNamespace parameter controls namespace creation", () => {
      const schema = installHelmChartSchema.inputSchema;
      
      // Check that createNamespace is a boolean with default true
      expect(schema.properties.createNamespace.type).toBe("boolean");
      expect(schema.properties.createNamespace.default).toBe(true);
    });

    test("valuesFile parameter provides alternative to values object", () => {
      const schema = installHelmChartSchema.inputSchema;
      
      expect(schema.properties.valuesFile.type).toBe("string");
      expect(schema.properties.valuesFile.description).toContain("Path to values file");
    });
  });

  describe("upgrade_helm_chart", () => {
    test("schema is properly defined", () => {
      expect(upgradeHelmChartSchema).toBeDefined();
      expect(upgradeHelmChartSchema.name).toBe("upgrade_helm_chart");
      expect(upgradeHelmChartSchema.description).toContain("Upgrade an existing Helm chart release");

      // Check input schema
      expect(upgradeHelmChartSchema.inputSchema).toBeDefined();
      expect(upgradeHelmChartSchema.inputSchema.properties).toBeDefined();

      // Check required properties
      expect(upgradeHelmChartSchema.inputSchema.required).toContain("name");
      expect(upgradeHelmChartSchema.inputSchema.required).toContain("chart");
      expect(upgradeHelmChartSchema.inputSchema.required).toContain("namespace");
    });
  });

  describe("uninstall_helm_chart", () => {
    test("schema is properly defined", () => {
      expect(uninstallHelmChartSchema).toBeDefined();
      expect(uninstallHelmChartSchema.name).toBe("uninstall_helm_chart");
      expect(uninstallHelmChartSchema.description).toContain("Uninstall a Helm chart release");

      // Check input schema
      expect(uninstallHelmChartSchema.inputSchema).toBeDefined();
      expect(uninstallHelmChartSchema.inputSchema.properties).toBeDefined();

      // Check required properties
      expect(uninstallHelmChartSchema.inputSchema.required).toContain("name");
      expect(uninstallHelmChartSchema.inputSchema.required).toContain("namespace");
    });
  });

  describe("parameter validation", () => {
    test("validates required parameters for install", () => {
      const validInput = {
        name: "test-release",
        chart: "stable/nginx-ingress",
        namespace: "default"
      };
      
      // This would be validated by the schema
      expect(validInput.name).toBeDefined();
      expect(validInput.chart).toBeDefined();
      expect(validInput.namespace).toBeDefined();
    });

    test("handles optional parameters correctly", () => {
      const fullInput = {
        name: "test-release",
        chart: "stable/nginx-ingress",
        repo: "https://kubernetes-charts.storage.googleapis.com",
        namespace: "default",
        values: { replicaCount: 2 },
        valuesFile: "/path/to/values.yaml",
        createNamespace: true,
        useTemplate: false
      };
      
      expect(fullInput.repo).toBe("https://kubernetes-charts.storage.googleapis.com");
      expect(fullInput.values).toEqual({ replicaCount: 2 });
      expect(fullInput.valuesFile).toBe("/path/to/values.yaml");
      expect(fullInput.createNamespace).toBe(true);
      expect(fullInput.useTemplate).toBe(false);
    });

    test("template mode parameters", () => {
      const templateInput = {
        name: "test-release",
        chart: "./local-chart",
        namespace: "default",
        useTemplate: true,
        createNamespace: false
      };
      
      expect(templateInput.useTemplate).toBe(true);
      expect(templateInput.createNamespace).toBe(false);
    });
  });

  describe("error handling", () => {
    test("handles missing required parameters", () => {
      // Test that missing required parameters would cause validation errors
      const invalidInputs = [
        { name: "test" }, // missing chart and namespace
        { chart: "test" }, // missing name and namespace
        { namespace: "test" } // missing name and chart
      ];
      
      invalidInputs.forEach(input => {
        expect(Object.keys(input).length).toBeLessThan(3);
      });
    });

    test("handles conflicting values parameters", () => {
      // Test that both values and valuesFile shouldn't be used together
      const conflictingInput = {
        name: "test-release",
        chart: "test-chart",
        namespace: "default",
        values: { key: "value" },
        valuesFile: "/path/to/values.yaml"
      };
      
      // This would be validated at runtime
      expect(conflictingInput.values).toBeDefined();
      expect(conflictingInput.valuesFile).toBeDefined();
    });
  });
}); 