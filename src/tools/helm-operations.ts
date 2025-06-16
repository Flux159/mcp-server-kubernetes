import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import yaml from "yaml";
import { HelmInstallOperation, HelmOperation, HelmResponse, HelmUpgradeOperation } from "../models/helm-models.js";

export const installHelmChartSchema = {
  name: "install_helm_chart",
  description: "Install a Helm chart",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Release name",
      },
      chart: {
        type: "string",
        description: "Chart name",
      },
      repo: {
        type: "string",
        description: "Chart repository URL",
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
    },
    required: ["name", "chart", "repo", "namespace"],
  },
};

export const upgradeHelmChartSchema = {
  name: "upgrade_helm_chart",
  description: "Upgrade a Helm release",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Release name",
      },
      chart: {
        type: "string",
        description: "Chart name",
      },
      repo: {
        type: "string",
        description: "Chart repository URL",
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
    },
    required: ["name", "chart", "repo", "namespace"],
  },
};

export const uninstallHelmChartSchema = {
  name: "uninstall_helm_chart",
  description: "Uninstall a Helm release",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Release name",
      },
      namespace: {
        type: "string",
        description: "Kubernetes namespace",
      },
    },
    required: ["name", "namespace"],
  },
};

const executeHelmCommand = (command: string): string => {
  try {
    // Add a generous timeout of 60 seconds for Helm operations
    return execSync(command, { 
      encoding: "utf8",
      timeout: 60000, // 60 seconds timeout
      env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG }
    });
  } catch (error: any) {
    throw new Error(`Helm command failed: ${error.message}`);
  }
};

const writeValuesFile = (name: string, values: Record<string, any>): string => {
  const filename = `${name}-values.yaml`;
  writeFileSync(filename, yaml.stringify(values));
  return filename;
};

export async function installHelmChart(params: HelmInstallOperation): Promise<{ content: { type: string; text: string }[] }> {
  try {
    // Add helm repository if provided
    if (params.repo) {
      const repoName = params.chart.split("/")[0];
      executeHelmCommand(`helm repo add ${repoName} ${params.repo}`);
      executeHelmCommand("helm repo update");
    }

    let command = `helm install ${params.name} ${params.chart} --namespace ${params.namespace} --create-namespace`;

    // Handle values if provided
    if (params.values) {
      const valuesFile = writeValuesFile(params.name, params.values);
      command += ` -f ${valuesFile}`;

      try {
        executeHelmCommand(command);
      } finally {
        // Cleanup values file
        unlinkSync(valuesFile);
      }
    } else {
      executeHelmCommand(command);
    }

    const response: HelmResponse = {
      status: "installed",
      message: `Successfully installed ${params.name}`,
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
    throw new Error(`Failed to install Helm chart: ${error.message}`);
  }
}

export async function upgradeHelmChart(params: HelmUpgradeOperation): Promise<{ content: { type: string; text: string }[] }> {
  try {
    // Add helm repository if provided
    if (params.repo) {
      const repoName = params.chart.split("/")[0];
      executeHelmCommand(`helm repo add ${repoName} ${params.repo}`);
      executeHelmCommand("helm repo update");
    }

    let command = `helm upgrade ${params.name} ${params.chart} --namespace ${params.namespace}`;

    // Handle values if provided
    if (params.values) {
      const valuesFile = writeValuesFile(params.name, params.values);
      command += ` -f ${valuesFile}`;

      try {
        executeHelmCommand(command);
      } finally {
        // Cleanup values file
        unlinkSync(valuesFile);
      }
    } else {
      executeHelmCommand(command);
    }

    const response: HelmResponse = {
      status: "upgraded",
      message: `Successfully upgraded ${params.name}`,
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
    throw new Error(`Failed to upgrade Helm chart: ${error.message}`);
  }
}

export async function uninstallHelmChart(params: HelmOperation): Promise<{ content: { type: string; text: string }[] }> {
  try {
    executeHelmCommand(`helm uninstall ${params.name} --namespace ${params.namespace}`);

    const response: HelmResponse = {
      status: "uninstalled",
      message: `Successfully uninstalled ${params.name}`,
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
    throw new Error(`Failed to uninstall Helm chart: ${error.message}`);
  }
}
