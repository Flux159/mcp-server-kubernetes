import { KubernetesManager } from "../types.js";
import {
  assertNotFlagLike,
  execFileSyncSafe,
} from "../security/kubectl-flags.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getSpawnMaxBuffer } from "../config/max-buffer.js";

export const kubectlTopSchema = {
  name: "kubectl_top",
  description:
    "Show live CPU and memory usage for nodes or pods (kubectl top equivalent). " +
    "Requires the Metrics API (e.g. metrics-server) in the target cluster.",
  annotations: {
    readOnlyHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      resourceType: {
        type: "string",
        enum: ["nodes", "pods"],
        description: "Whether to show usage for nodes or pods",
      },
      context: {
        type: "string",
        description:
          "Kubeconfig context to query. Required so the cluster being measured is always explicit.",
      },
      name: {
        type: "string",
        description: "Name of a single node or pod to show (optional)",
      },
      namespace: {
        type: "string",
        description:
          "Namespace to show pod usage for (pods only, defaults to 'default')",
      },
      allNamespaces: {
        type: "boolean",
        description: "If true, show pod usage across all namespaces (pods only)",
        default: false,
      },
      includeRaw: {
        type: "boolean",
        description: "If true, also return the raw kubectl top table output",
        default: false,
      },
    },
    required: ["resourceType", "context"],
  },
} as const;

export interface KubectlTopInput {
  resourceType: string;
  context: string;
  name?: string;
  namespace?: string;
  allNamespaces?: boolean;
  includeRaw?: boolean;
}

export interface TopItem {
  name: string;
  namespace?: string;
  cpu: string;
  memory: string;
  cpuPercent?: string;
  memoryPercent?: string;
  cpuCores?: number;
  memoryBytes?: number;
}

const CPU_SUFFIXES: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  "": 1,
};

const MEMORY_SUFFIXES: Record<string, number> = {
  "": 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
};

function parseQuantity(
  value: string,
  suffixes: Record<string, number>
): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([A-Za-z]*)$/.exec(value);
  if (!match) return undefined;
  const multiplier = suffixes[match[2]];
  if (multiplier === undefined) return undefined;
  return Number(match[1]) * multiplier;
}

/** Converts a CPU quantity such as "250m" or "2" to cores. */
export function parseCpuCores(value: string): number | undefined {
  const cores = parseQuantity(value, CPU_SUFFIXES);
  // Round away float noise from the suffix multiplication (0.25000000000000006).
  return cores === undefined ? undefined : Number(cores.toPrecision(12));
}

/** Converts a memory quantity such as "128Mi" or "1G" to bytes. */
export function parseMemoryBytes(value: string): number | undefined {
  const bytes = parseQuantity(value, MEMORY_SUFFIXES);
  return bytes === undefined ? undefined : Math.round(bytes);
}

/**
 * Parses the table printed by `kubectl top nodes|pods`. Columns are located by
 * header name rather than position, since kubectl versions differ in which
 * percentage/swap columns they print.
 */
export function parseTopOutput(raw: string): TopItem[] {
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const headers = lines[0].trim().split(/\s+/).map((h) => h.toUpperCase());
  const column = (...names: string[]) =>
    headers.findIndex((h) => names.includes(h));

  const nameCol = column("NAME");
  const namespaceCol = column("NAMESPACE");
  const cpuCol = column("CPU(CORES)");
  const cpuPercentCol = column("CPU(%)", "CPU%");
  const memoryCol = column("MEMORY(BYTES)");
  const memoryPercentCol = column("MEMORY(%)", "MEMORY%");

  if (nameCol === -1 || cpuCol === -1 || memoryCol === -1) {
    throw new Error(`Unrecognized kubectl top output header: ${lines[0]}`);
  }

  return lines.slice(1).map((line) => {
    const fields = line.trim().split(/\s+/);
    const cpu = fields[cpuCol] ?? "";
    const memory = fields[memoryCol] ?? "";
    const item: TopItem = { name: fields[nameCol], cpu, memory };

    if (namespaceCol !== -1) item.namespace = fields[namespaceCol];
    if (cpuPercentCol !== -1) item.cpuPercent = fields[cpuPercentCol];
    if (memoryPercentCol !== -1) item.memoryPercent = fields[memoryPercentCol];

    const cpuCores = parseCpuCores(cpu);
    if (cpuCores !== undefined) item.cpuCores = cpuCores;
    const memoryBytes = parseMemoryBytes(memory);
    if (memoryBytes !== undefined) item.memoryBytes = memoryBytes;

    return item;
  });
}

function isMetricsUnavailable(message: string): boolean {
  return /metrics api not available|metrics not available|metrics\.k8s\.io|the server could not find the requested resource \(get (pods|nodes)\.metrics/i.test(
    message
  );
}

export async function kubectlTop(
  k8sManager: KubernetesManager,
  input: KubectlTopInput
) {
  const resourceType = (input.resourceType || "").toLowerCase();
  if (resourceType !== "nodes" && resourceType !== "pods") {
    throw new McpError(
      ErrorCode.InvalidParams,
      `resourceType must be "nodes" or "pods", got "${input.resourceType}"`
    );
  }

  const context = (input.context || "").trim();
  if (!context) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "context is required for kubectl_top so the cluster being measured is explicit"
    );
  }

  // Name and namespace are RFC 1123 names, never flags.
  assertNotFlagLike(input.name, "name");
  assertNotFlagLike(input.namespace, "namespace");

  const args = ["top", resourceType];
  if (input.name) args.push(input.name);

  if (resourceType === "pods") {
    if (input.allNamespaces) {
      args.push("--all-namespaces");
    } else {
      args.push("-n", input.namespace || "default");
    }
  }

  args.push("--context", context);

  let raw: string;
  try {
    raw = execFileSyncSafe("kubectl", args, {
      encoding: "utf8",
      maxBuffer: getSpawnMaxBuffer(),
      env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
    });
  } catch (error: any) {
    if (error instanceof McpError) throw error;

    const message = `${error.stderr ?? ""}\n${error.message ?? ""}`.trim();
    if (isMetricsUnavailable(message)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Metrics API not available",
                status: "metrics_unavailable",
                context,
                hint:
                  "kubectl top needs the Metrics API (metrics.k8s.io). Install metrics-server " +
                  "(https://github.com/kubernetes-sigs/metrics-server) or enable your provider's " +
                  "metrics add-on, then retry. Freshly started pods may take a minute to report.",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute kubectl top: ${message}`
    );
  }

  let items: TopItem[];
  try {
    items = parseTopOutput(raw);
  } catch (error: any) {
    throw new McpError(ErrorCode.InternalError, error.message);
  }

  const result: Record<string, unknown> = {
    resourceType,
    context,
    items,
  };
  if (resourceType === "pods") {
    result.namespace = input.allNamespaces
      ? "all"
      : input.namespace || "default";
  }
  if (input.includeRaw) result.raw = raw;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
