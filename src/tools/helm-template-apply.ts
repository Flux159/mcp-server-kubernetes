import { execFileSync } from "child_process";
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "yaml";
import { getSpawnMaxBuffer } from "../config/max-buffer.js";

export const helmTemplateApplySchema = {
  name: "helm_template_apply",
  description: "Install a Helm chart using template generation and kubectl apply (bypasses authentication issues)",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Release name",
      },
      chart: {
        type: "string",
        description: "Chart name or path to chart directory",
      },
      repo: {
        type: "string",
        description: "Chart repository URL (optional if using local chart path)",
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
      createNamespace: {
        type: "boolean",
        description: "Whether to create the namespace if it doesn't exist",
        default: true,
      },
    },
    required: ["name", "chart", "namespace"],
  },
};

interface HelmTemplateApplyParams {
  name: string;
  chart: string;
  repo?: string;
  namespace: string;
  values?: Record<string, any>;
  valuesFile?: string;
  createNamespace?: boolean;
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

const writeValuesFile = (name: string, values: Record<string, any>): string => {
  const filename = `${name}-values.yaml`;
  writeFileSync(filename, yaml.stringify(values));
  return filename;
};

export async function helmTemplateApply(
  params: HelmTemplateApplyParams
): Promise<{ content: { type: string; text: string }[] }> {
  const tempDir = mkdtempSync(join(tmpdir(), 'helm-template-'));
  let valuesFilePath: string | undefined;
  let generatedYamlPath: string | undefined;

  try {
    // Step 1: Add helm repository if provided
    if (params.repo) {
      const repoName = params.chart.split("/")[0];
      executeCommand("helm", ["repo", "add", repoName, params.repo]);
      executeCommand("helm", ["repo", "update"]);
    }

    // Step 2: Create namespace if requested
    if (params.createNamespace !== false) {
      try {
        executeCommand("kubectl", ["create", "namespace", params.namespace]);
      } catch (error: any) {
        // Namespace might already exist, which is fine
        if (!error.message.includes("already exists")) {
          throw error;
        }
      }
    }

    // Step 3: Prepare values file
    if (params.valuesFile) {
      valuesFilePath = params.valuesFile;
    } else if (params.values) {
      valuesFilePath = join(tempDir, `${params.name}-values.yaml`);
      writeFileSync(valuesFilePath, yaml.stringify(params.values));
    }

    // Step 4: Generate YAML using helm template
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

    // Step 5: Save generated YAML to temporary file
    generatedYamlPath = join(tempDir, `${params.name}-generated.yaml`);
    writeFileSync(generatedYamlPath, generatedYaml);

    // Step 6: Apply the generated YAML using kubectl
    executeCommand("kubectl", ["apply", "-f", generatedYamlPath, "-n", params.namespace]);

    const response = {
      status: "installed",
      message: `Successfully installed ${params.name} using helm template + kubectl apply`,
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
    throw new Error(`Failed to install Helm chart using template method: ${error.message}`);
  } finally {
    // Cleanup temporary files
    try {
      if (valuesFilePath && valuesFilePath.startsWith(tempDir)) {
        unlinkSync(valuesFilePath);
      }
      if (generatedYamlPath) {
        unlinkSync(generatedYamlPath);
      }
      // Remove temp directory
      rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
} 