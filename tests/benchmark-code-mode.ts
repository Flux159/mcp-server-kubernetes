/**
 * Benchmark: measure actual byte savings of code-mode vs existing tool responses.
 *
 * "Before" simulates what kubectl_get / list_api_resources actually returns
 * (already formatted, not raw kubectl JSON). "After" shows what kubectl_code_mode
 * returns for the same query. Both sides use the exact same kubectl command.
 *
 * Usage:
 *   KUBECONFIG=~/.kube/config npx tsx tests/benchmark-code-mode.ts
 *
 * Requires a running cluster.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { PolyglotExecutor } from "../src/utils/executor.js";
import { detectRuntimes, getAvailableLanguages } from "../src/utils/runtime.js";

const runtimes = detectRuntimes();
const executor = new PolyglotExecutor({ runtimes });
const langs = getAvailableLanguages(runtimes);

console.log("Available languages:", langs.join(", "));
console.log("");

// ─── Helpers ───

function kubectl(args: string): string {
  const parts = args.split(/\s+/);
  return execFileSync("kubectl", parts, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
  });
}

function injectData(data: string, code: string): string {
  const escaped = JSON.stringify(data);
  return `const DATA = ${escaped};\n${code}`;
}

// Simulate what kubectl_get returns for list operations (src/tools/kubectl-get.ts:176-228).
// It parses the raw JSON and returns { items: [{ name, namespace, kind, status, createdAt }] }
// for non-event resources, and { events: [{ type, reason, message, involvedObject, ... }] }
// for events.
function simulateKubectlGetResponse(rawJson: string, resourceType: string): string {
  const parsed = JSON.parse(rawJson);
  if (!parsed.kind?.endsWith("List") || !parsed.items) return rawJson;

  if (resourceType === "events") {
    const formattedEvents = parsed.items.map((event: any) => ({
      type: event.type || "",
      reason: event.reason || "",
      message: event.message || "",
      involvedObject: {
        kind: event.involvedObject?.kind || "",
        name: event.involvedObject?.name || "",
        namespace: event.involvedObject?.namespace || "",
      },
      firstTimestamp: event.firstTimestamp || "",
      lastTimestamp: event.lastTimestamp || "",
      count: event.count || 0,
    }));
    return JSON.stringify({ events: formattedEvents }, null, 2);
  }

  const items = parsed.items.map((item: any) => ({
    name: item.metadata?.name || "",
    namespace: item.metadata?.namespace || "",
    kind: item.kind || resourceType,
    status: getSimpleStatus(item, resourceType),
    createdAt: item.metadata?.creationTimestamp,
  }));
  return JSON.stringify({ items }, null, 2);
}

// Simplified version of getResourceStatus from kubectl-get.ts
function getSimpleStatus(resource: any, resourceType: string): string {
  if (resourceType === "pods" || resourceType === "pod") {
    return resource.status?.phase || "Unknown";
  }
  if (resource.status?.readyReplicas !== undefined) {
    return `${resource.status.readyReplicas || 0}/${resource.status.replicas || 0} ready`;
  }
  if (resource.spec?.type) return resource.spec.type;
  if (resource.status?.conditions) {
    const ready = resource.status.conditions.find((c: any) => c.type === "Ready");
    if (ready) return ready.status === "True" ? "Ready" : "NotReady";
  }
  if (resource.status?.phase) return resource.status.phase;
  return "Active";
}

interface TestCase {
  name: string;
  kubectlArgs: string;
  resourceType: string; // used to simulate kubectl_get formatting
  isApiResources?: boolean; // list_api_resources returns raw text, not JSON
  code: string;
}

// ─── Test cases ───
// Each case uses the exact same kubectl command for both "before" and "after".
// "Before" = what kubectl_get actually returns (already formatted).
// "After"  = what kubectl_code_mode returns (script stdout only).

const testCases: TestCase[] = [
  // Mimics: kubectl_get({ resourceType: "pods", allNamespaces: true, output: "json" })
  // kubectl_get returns: { items: [{ name, namespace, kind, status, createdAt }, ...] }
  {
    name: "List all pods (all namespaces)",
    kubectlArgs: "get pods -A -o json",
    resourceType: "pods",
    code: `
const pods = JSON.parse(DATA).items;
const summary = pods.map(p => {
  const phase = p.status?.phase || "Unknown";
  const restarts = (p.status?.containerStatuses || []).reduce((s, c) => s + c.restartCount, 0);
  return p.metadata.namespace + "/" + p.metadata.name + " " + phase + " restarts=" + restarts;
});
console.log("Pods: " + pods.length);
summary.forEach(l => console.log(l));
`,
  },
  // Mimics: kubectl_get({ resourceType: "deployments", allNamespaces: true, output: "json" })
  // kubectl_get returns: { items: [{ name, namespace, kind, status, createdAt }, ...] }
  {
    name: "List all deployments (all namespaces)",
    kubectlArgs: "get deployments -A -o json",
    resourceType: "deployments",
    code: `
const deps = JSON.parse(DATA).items;
deps.forEach(d => {
  const ready = d.status?.readyReplicas || 0;
  const desired = d.spec?.replicas || 0;
  console.log(d.metadata.namespace + "/" + d.metadata.name + " " + ready + "/" + desired);
});
console.log("Total: " + deps.length);
`,
  },
  // Mimics: kubectl_get({ resourceType: "services", allNamespaces: true, output: "json" })
  // kubectl_get returns: { items: [{ name, namespace, kind, status, createdAt }, ...] }
  {
    name: "List all services (all namespaces)",
    kubectlArgs: "get services -A -o json",
    resourceType: "services",
    code: `
const svcs = JSON.parse(DATA).items;
svcs.forEach(s => {
  const type = s.spec?.type || "ClusterIP";
  const ports = (s.spec?.ports || []).map(p => p.port + "/" + p.protocol).join(",");
  console.log(s.metadata.namespace + "/" + s.metadata.name + " " + type + " " + ports);
});
console.log("Total: " + svcs.length);
`,
  },
  // Mimics: kubectl_get({ resourceType: "events", allNamespaces: true, output: "json" })
  // kubectl_get returns: { events: [{ type, reason, message, involvedObject, timestamps, count }, ...] }
  {
    name: "List all events (all namespaces)",
    kubectlArgs: "get events -A -o json",
    resourceType: "events",
    code: `
const events = JSON.parse(DATA).items;
const warnings = events.filter(e => e.type === "Warning");
const recent = events.slice(-20);
console.log("Events: " + events.length + " (" + warnings.length + " warnings)");
console.log("\\nLast 20:");
recent.forEach(e => {
  console.log(e.type + " " + e.reason + " " + (e.involvedObject?.name || "") + ": " + (e.message || "").slice(0, 100));
});
`,
  },
  // Mimics: kubectl_get({ resourceType: "configmaps", allNamespaces: true, output: "json" })
  // kubectl_get returns: { items: [{ name, namespace, kind, status, createdAt }, ...] }
  {
    name: "List all configmaps (all namespaces)",
    kubectlArgs: "get configmaps -A -o json",
    resourceType: "configmaps",
    code: `
const cms = JSON.parse(DATA).items;
cms.forEach(c => {
  const keys = Object.keys(c.data || {});
  console.log(c.metadata.namespace + "/" + c.metadata.name + " keys=" + keys.length);
});
console.log("Total: " + cms.length);
`,
  },
  // Mimics: kubectl_get({ resourceType: "nodes", output: "json" })
  // kubectl_get returns: { items: [{ name, namespace, kind, status, createdAt }, ...] }
  {
    name: "List nodes",
    kubectlArgs: "get nodes -o json",
    resourceType: "nodes",
    code: `
const nodes = JSON.parse(DATA).items;
nodes.forEach(n => {
  const ready = (n.status?.conditions || []).find(c => c.type === "Ready");
  const cpu = n.status?.capacity?.cpu || "?";
  const mem = n.status?.capacity?.memory || "?";
  console.log(n.metadata.name + " " + (ready?.status === "True" ? "Ready" : "NotReady") + " cpu=" + cpu + " mem=" + mem);
});
`,
  },
  // Mimics: list_api_resources({})
  // list_api_resources returns raw text output (not JSON formatted)
  {
    name: "List API resources",
    kubectlArgs: "api-resources",
    resourceType: "",
    isApiResources: true,
    code: `
const lines = DATA.split("\\n").filter(Boolean);
console.log("API resource types: " + (lines.length - 1));
console.log(lines[0]);
`,
  },
];

// ─── Run benchmark ───

interface Result {
  name: string;
  kubectlArgs: string;
  toolResponseBytes: number;
  codeModeBytes: number;
  reductionPct: string;
  error?: string;
}

async function run() {
  const results: Result[] = [];

  for (const tc of testCases) {
    process.stdout.write(`Running: ${tc.name}... `);

    try {
      // Run the same kubectl command for both sides
      const rawOutput = kubectl(tc.kubectlArgs);

      // "Before" — simulate what the existing MCP tool actually returns
      const toolResponse = tc.isApiResources
        ? rawOutput // list_api_resources returns raw text
        : simulateKubectlGetResponse(rawOutput, tc.resourceType);
      const toolResponseBytes = Buffer.byteLength(toolResponse);

      // "After" — code-mode processes raw output, returns only script stdout
      const wrappedCode = injectData(rawOutput, tc.code);
      const execResult = await executor.execute({
        language: "javascript",
        code: wrappedCode,
        timeout: 15_000,
      });

      const codeModeOutput = execResult.stdout || "";
      const codeModeBytes = Buffer.byteLength(codeModeOutput);

      const reductionPct = toolResponseBytes > 0
        ? ((1 - codeModeBytes / toolResponseBytes) * 100).toFixed(1)
        : "0";

      results.push({
        name: tc.name,
        kubectlArgs: tc.kubectlArgs,
        toolResponseBytes,
        codeModeBytes,
        reductionPct: reductionPct + "%",
      });

      console.log(`${kb(toolResponseBytes)} → ${kb(codeModeBytes)} (${reductionPct}%)`);

      if (execResult.stderr && execResult.exitCode !== 0) {
        console.log(`  stderr: ${execResult.stderr.slice(0, 200)}`);
      }
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
      results.push({
        name: tc.name,
        kubectlArgs: tc.kubectlArgs,
        toolResponseBytes: 0,
        codeModeBytes: 0,
        reductionPct: "N/A",
        error: err.message,
      });
    }
  }

  // ─── Summary ───
  console.log("\n\n## Benchmark Results\n");
  console.log("| Test | Tool Response | Code-Mode Output | Reduction |");
  console.log("|---|---|---|---|");
  for (const r of results) {
    console.log(
      `| ${r.name} | ${kb(r.toolResponseBytes)} | ${kb(r.codeModeBytes)} | ${r.reductionPct} |`
    );
  }

  const totalTool = results.reduce((s, r) => s + r.toolResponseBytes, 0);
  const totalCode = results.reduce((s, r) => s + r.codeModeBytes, 0);
  const totalPct = totalTool > 0
    ? ((1 - totalCode / totalTool) * 100).toFixed(1)
    : "0";
  console.log(
    `| **Total** | **${kb(totalTool)}** | **${kb(totalCode)}** | **${totalPct}%** |`
  );

  console.log(`\nTokens saved: ~${Math.round((totalTool - totalCode) / 4).toLocaleString()}`);

  // Write results file
  const outPath = "tests/benchmark-results.json";
  writeFileSync(
    outPath,
    JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
  );
  console.log(`\nResults written to ${outPath}`);
}

function kb(b: number): string {
  if (b === 0) return "0B";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

run().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
