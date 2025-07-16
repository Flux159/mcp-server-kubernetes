import { execFileSync } from "child_process";
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "yaml";
import { getSpawnMaxBuffer } from "../config/max-buffer.js";

export const helmTemplateUninstallSchema = {
  name: "helm_template_uninstall",
  description: "Uninstall a Helm chart by deleting resources using YAML generated from helm template (bypasses authentication issues)",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Release name (for reference)",
      },
      chart: {
        type: "string",
        description: "Chart name or path to chart directory",
      },
      namespace: {
        type: "string",
        description: "Kubernetes namespace",
      },
      values: {
        type: "object",
        description: "Chart values",
        properties: {},
        additionalProperties: true,
      },
      valuesFile: {
        type: "string",
        description: "Path to values.yaml file (optional, alternative to values object)",
      },
    },
    required: ["name", "chart", "namespace"],
  },
};

interface HelmTemplateUninstallParams {
  name: string;
  chart: string;
  namespace: string;
  values?: Record<string, any>;
  valuesFile?: string;
}

const executeCommand = (command: string, args: string[]): string => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 60000, // 60 seconds timeout
      maxBuffer: getSpawnMaxBuffer(),
      env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
    });
  } catch (error: any) {
    throw new Error(`${command} command failed: ${error.message}`);
  }
};

export async function helmTemplateUninstall(
  params: HelmTemplateUninstallParams
): Promise<{ content: { type: string; text: string }[] }> {
  const tempDir = mkdtempSync(join(tmpdir(), 'helm-template-uninstall-'));
  let valuesFilePath: string | undefined;
  let generatedYamlPath: string | undefined;

  try {
    // Step 1: Prepare values file
    if (params.valuesFile) {
      valuesFilePath = params.valuesFile;
    } else if (params.values) {
      valuesFilePath = join(tempDir, `${params.name}-values.yaml`);
      writeFileSync(valuesFilePath, yaml.stringify(params.values));
    }

    // Step 2: Generate YAML using helm template
    const helmArgs = [
      "template",
      params.name,
      params.chart,
      "--namespace",
      params.namespace,
    ];
    if (valuesFilePath && valuesFilePath !== params.valuesFile) {
      helmArgs.push("-f", valuesFilePath);
    } else if (params.valuesFile) {
      helmArgs.push("-f", params.valuesFile);
    }
    const generatedYaml = executeCommand("helm", helmArgs);

    // Step 3: Save generated YAML to temporary file
    generatedYamlPath = join(tempDir, `${params.name}-generated.yaml`);
    writeFileSync(generatedYamlPath, generatedYaml);

    // Step 4: Delete the resources using kubectl
    executeCommand("kubectl", ["delete", "-f", generatedYamlPath, "-n", params.namespace]);

    const response = {
      status: "uninstalled",
      message: `Successfully uninstalled ${params.name} using helm template + kubectl delete`,
      details: {
        namespace: params.namespace,
        chart: params.chart,
        generatedYamlPath: generatedYamlPath,
        valuesUsed: valuesFilePath || "default values",
      },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to uninstall Helm chart using template method: ${error.message}`);
  } finally {
    // Cleanup temporary files
    try {
      if (valuesFilePath && valuesFilePath.startsWith(tempDir)) {
        unlinkSync(valuesFilePath);
      }
      if (generatedYamlPath) {
        unlinkSync(generatedYamlPath);
      }
      rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
} 