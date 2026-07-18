/**
 * Tool: install_helm_chart
 * Install a Helm chart with support for both standard Helm install and template-based installation.
 * Template mode bypasses authentication issues and kubeconfig API version mismatches.
 * Supports local chart paths, remote repositories, and custom values.
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { execFileSyncSafe } from "../security/kubectl-flags.js";
import { writeFileSync, unlinkSync } from "fs";
import { dump } from "js-yaml";
import { isRemoteTransport } from "../security/transport.js";
import { getSpawnMaxBuffer } from "../config/max-buffer.js";
import {
  contextParameter,
  namespaceParameter,
} from "../models/common-parameters.js";
import {
  HelmInstallOperation,
  HelmUpgradeOperation,
  HelmUninstallOperation,
} from "../models/helm-models.js";

/**
 * Schema for install_helm_chart tool.
 * - name: Release name
 * - chart: Chart name or path to chart directory
 * - namespace: Target namespace
 * - repo: (Optional) Helm repository URL
 * - values: (Optional) Custom values object
 * - valuesFile: (Optional) Path to values file
 * - useTemplate: (Optional) Use template mode instead of helm install
 * - createNamespace: (Optional) Create namespace if it doesn't exist
 */
export const installHelmChartSchema = {
  name: "install_helm_chart",
  description:
    "Install a Helm chart with support for both standard and template-based installation",
  annotations: {
    destructiveHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the Helm release",
      },
      chart: {
        type: "string",
        description: "Chart name (e.g., 'nginx') or path to chart directory",
      },
      namespace: namespaceParameter,
      context: contextParameter,
      repo: {
        type: "string",
        description: "Helm repository URL (optional if using local chart path)",
      },
      values: {
        type: "object",
        description: "Custom values to override chart defaults",
      },
      valuesFile: {
        type: "string",
        description:
          "Path to values file (alternative to values object). The path is read on the machine running the MCP server, so it is rejected when the server runs over a remote (SSE/Streamable HTTP) transport; use 'values' to pass the values inline instead.",
      },
      useTemplate: {
        type: "boolean",
        description:
          "Use helm template + kubectl apply instead of helm install (bypasses auth issues)",
        default: false,
      },
      createNamespace: {
        type: "boolean",
        description: "Create namespace if it doesn't exist",
        default: true,
      },
    },
    required: ["name", "chart", "namespace"],
  },
};

/**
 * Schema for upgrade_helm_chart tool.
 * - name: Release name
 * - chart: Chart name or path
 * - namespace: Target namespace
 * - repo: (Optional) Helm repository URL
 * - values: (Optional) Custom values object
 * - valuesFile: (Optional) Path to values file
 */
export const upgradeHelmChartSchema = {
  name: "upgrade_helm_chart",
  description: "Upgrade an existing Helm chart release",
  annotations: {
    destructiveHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the Helm release to upgrade",
      },
      chart: {
        type: "string",
        description: "Chart name or path to chart directory",
      },
      namespace: namespaceParameter,
      context: contextParameter,
      repo: {
        type: "string",
        description: "Helm repository URL (optional if using local chart path)",
      },
      values: {
        type: "object",
        description: "Custom values to override chart defaults",
      },
      valuesFile: {
        type: "string",
        description:
          "Path to values file (alternative to values object). The path is read on the machine running the MCP server, so it is rejected when the server runs over a remote (SSE/Streamable HTTP) transport; use 'values' to pass the values inline instead.",
      },
    },
    required: ["name", "chart", "namespace"],
  },
};

/**
 * Schema for uninstall_helm_chart tool.
 * - name: Release name
 * - namespace: Target namespace
 */
export const uninstallHelmChartSchema = {
  name: "uninstall_helm_chart",
  description: "Uninstall a Helm chart release",
  annotations: {
    destructiveHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the Helm release to uninstall",
      },
      namespace: namespaceParameter,
      context: contextParameter,
    },
    required: ["name", "namespace"],
  },
};

/**
 * Execute a command using child_process.execFileSync with proper error handling.
 * @param command - The command to execute
 * @param args - Array of command arguments
 * @returns The command output as a string
 * @throws Error if command execution fails
 */
const executeCommand = (command: string, args: string[]): string => {
  try {
    return execFileSyncSafe(command, args, {
      encoding: "utf8",
      timeout: 300000, // 5 minutes timeout
      maxBuffer: getSpawnMaxBuffer(),
      env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
    });
  } catch (error: any) {
    throw new Error(`${command} command failed: ${error.message}`);
  }
};

// Reject server-side filesystem reads on remote transports. Over SSE /
// Streamable HTTP the path resolves on the MCP server host, not the client,
// so `valuesFile` (-f) would let any client that can reach the endpoint read
// arbitrary server files (kubeconfig, service-account token,
// /proc/self/environ, etc.) via helm's parse errors. Clients on these
// transports must pass values inline via `values` instead.
const rejectValuesFileOnRemoteTransport = (valuesFile?: string): void => {
  if (valuesFile && isRemoteTransport()) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "The 'valuesFile' parameter reads a file from the MCP server's filesystem and is disabled on remote (SSE/Streamable HTTP) transports. Pass the values inline via 'values' instead."
    );
  }
};

/**
 * Install a Helm chart using template mode (helm template + kubectl apply).
 * This mode bypasses authentication issues and kubeconfig API version mismatches.
 * @param params - Installation parameters
 * @returns Promise with installation result
 */
async function installHelmChartTemplate(params: {
  name: string;
  chart: string;
  namespace: string;
  repo?: string;
  values?: object;
  valuesFile?: string;
}): Promise<{ content: { type: string; text: string }[] }> {
  const steps: string[] = [];

  try {
    // Step 1: Add helm repository if provided
    if (params.repo) {
      steps.push(`Adding helm repository: ${params.repo}`);
      executeCommand("helm", ["repo", "add", "temp-repo", params.repo]);
      executeCommand("helm", ["repo", "update"]);
    }

    // Step 2: Create namespace
    steps.push(`Creating namespace: ${params.namespace}`);
    try {
      executeCommand("kubectl", ["create", "namespace", params.namespace]);
    } catch (error: any) {
      if (!error.message.includes("already exists")) {
        throw error;
      }
      steps.push(`Namespace ${params.namespace} already exists`);
    }

    // Step 3: Generate YAML using helm template
    steps.push("Generating YAML using helm template");
    const templateArgs = [
      "template",
      params.name,
      params.chart,
      "--namespace",
      params.namespace,
    ];

    if (params.repo) {
      templateArgs.push("--repo", params.repo);
    }

    let tempValuesFile: string | null = null;
    if (params.valuesFile) {
      // Hand the path to helm directly rather than reading the file's
      // contents into this process.
      steps.push(`Using values file: ${params.valuesFile}`);
      templateArgs.push("-f", params.valuesFile);
    } else if (params.values) {
      steps.push("Using provided values object");
      tempValuesFile = `/tmp/values-${Date.now()}.yaml`;
      writeFileSync(tempValuesFile, dump(params.values));
      templateArgs.push("-f", tempValuesFile);
    }

    let yamlOutput: string;
    try {
      yamlOutput = executeCommand("helm", templateArgs);
    } finally {
      // Clean up temp file
      if (tempValuesFile) {
        unlinkSync(tempValuesFile);
      }
    }

    // Step 4: Apply YAML using kubectl
    steps.push("Applying YAML using kubectl");
    const tempYamlFile = `/tmp/helm-template-${Date.now()}.yaml`;
    writeFileSync(tempYamlFile, yamlOutput);

    try {
      executeCommand("kubectl", ["apply", "-f", tempYamlFile]);
      steps.push("Helm chart installed successfully using template mode");
    } finally {
      // Clean up temp file
      unlinkSync(tempYamlFile);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "installed",
            message: `Helm chart '${params.name}' installed successfully using template mode`,
            steps: steps,
          }),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "failed",
            error: `Failed to install Helm chart using template mode: ${error.message}`,
            steps: steps,
          }),
        },
      ],
    };
  }
}

/**
 * Install a Helm chart using standard helm install command.
 * @param params - Installation parameters
 * @returns Promise with installation result
 */
export async function installHelmChart(
  params: HelmInstallOperation
): Promise<{ content: { type: string; text: string }[] }> {
  rejectValuesFileOnRemoteTransport(params.valuesFile);

  // Use template mode if requested
  if (params.useTemplate) {
    return installHelmChartTemplate(params);
  }

  try {
    // Add repository if provided
    if (params.repo) {
      const repoName = params.chart.split("/")[0];
      executeCommand("helm", ["repo", "add", repoName, params.repo]);
      executeCommand("helm", ["repo", "update"]);
    }

    const args = [
      "install",
      params.name,
      params.chart,
      "--namespace",
      params.namespace,
    ];

    // Add create namespace flag if requested
    if (params.createNamespace !== false) {
      args.push("--create-namespace");
    }

    // Add values file if provided
    if (params.valuesFile) {
      args.push("-f", params.valuesFile);
    }

    // Add values object if provided
    if (params.values) {
      const valuesContent = dump(params.values);
      const tempFile = `/tmp/values-${Date.now()}.yaml`;
      writeFileSync(tempFile, valuesContent);

      try {
        args.push("-f", tempFile);
        executeCommand("helm", args);
      } finally {
        unlinkSync(tempFile);
      }
    } else {
      executeCommand("helm", args);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "installed",
            message: `Helm chart '${params.name}' installed successfully in namespace '${params.namespace}'`,
          }),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "failed",
            error: `Failed to install Helm chart: ${error.message}`,
          }),
        },
      ],
    };
  }
}

/**
 * Upgrade an existing Helm chart release.
 * @param params - Upgrade parameters
 * @returns Promise with upgrade result
 */
export async function upgradeHelmChart(
  params: HelmUpgradeOperation
): Promise<{ content: { type: string; text: string }[] }> {
  rejectValuesFileOnRemoteTransport(params.valuesFile);

  try {
    // Add repository if provided
    if (params.repo) {
      const repoName = params.chart.split("/")[0];
      executeCommand("helm", ["repo", "add", repoName, params.repo]);
      executeCommand("helm", ["repo", "update"]);
    }

    const args = [
      "upgrade",
      params.name,
      params.chart,
      "--namespace",
      params.namespace,
    ];

    // Add values file if provided
    if (params.valuesFile) {
      args.push("-f", params.valuesFile);
    }

    // Add values object if provided
    if (params.values) {
      const valuesContent = dump(params.values);
      const tempFile = `/tmp/values-${Date.now()}.yaml`;
      writeFileSync(tempFile, valuesContent);

      try {
        args.push("-f", tempFile);
        executeCommand("helm", args);
      } finally {
        unlinkSync(tempFile);
      }
    } else {
      executeCommand("helm", args);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "upgraded",
            message: `Helm chart '${params.name}' upgraded successfully in namespace '${params.namespace}'`,
          }),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "failed",
            error: `Failed to upgrade Helm chart: ${error.message}`,
          }),
        },
      ],
    };
  }
}

/**
 * Uninstall a Helm chart release.
 * @param params - Uninstall parameters
 * @returns Promise with uninstall result
 */
export async function uninstallHelmChart(
  params: HelmUninstallOperation
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    executeCommand("helm", [
      "uninstall",
      params.name,
      "--namespace",
      params.namespace,
    ]);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "uninstalled",
            message: `Helm chart '${params.name}' uninstalled successfully from namespace '${params.namespace}'`,
          }),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "failed",
            error: `Failed to uninstall Helm chart: ${error.message}`,
          }),
        },
      ],
    };
  }
}
