import { execFileSync } from "node:child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getSpawnMaxBuffer } from "../config/max-buffer.js";
import { PolyglotExecutor } from "../utils/executor.js";
import { getAvailableLanguages, detectRuntimes } from "../utils/runtime.js";
import { contextParameter } from "../models/common-parameters.js";
import type { Language } from "../utils/runtime.js";

const runtimes = detectRuntimes();
const executor = new PolyglotExecutor({ runtimes });
const availableLanguages = getAvailableLanguages(runtimes);

export const kubectlCodeModeSchema = {
  name: "kubectl_code_mode",
  description:
    "Run a kubectl command and process its output with code in a sandbox. " +
    "The raw kubectl output is available as the DATA variable (string). " +
    "Only your script's stdout enters context — raw output stays internal. " +
    "Use when kubectl output would be large (list all pods, logs, describe nodes). " +
    `Available languages: ${availableLanguages.join(", ")}.`,
  annotations: {
    readOnlyHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      args: {
        type: "string",
        description:
          "kubectl arguments as a single string, e.g. 'get pods -A -o json', " +
          "'logs my-pod --tail=500', 'describe node my-node'. " +
          "Do NOT include 'kubectl' prefix.",
      },
      language: {
        type: "string",
        enum: availableLanguages,
        description: "Language for the processing script.",
        default: "javascript",
      },
      code: {
        type: "string",
        description:
          "Code to process the kubectl output. The raw output is available as " +
          "the DATA variable (string). Print your summary to stdout via " +
          "console.log (JS/TS), print (Python), echo (shell), etc. " +
          "Only stdout enters context.",
      },
      context: contextParameter,
    },
    required: ["args", "code"],
  },
} as const;

export async function kubectlCodeMode(input: {
  args: string;
  language?: string;
  code: string;
  context?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const language = (input.language ?? "javascript") as Language;

  if (!availableLanguages.includes(language)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Language "${language}" is not available. Available: ${availableLanguages.join(", ")}`,
    );
  }

  // 1. Build kubectl command args
  const kubectlArgs = parseArgs(input.args);
  if (input.context) {
    kubectlArgs.push("--context", input.context);
  }

  // 2. Run kubectl, capture raw output
  let rawOutput: string;
  try {
    rawOutput = execFileSync("kubectl", kubectlArgs, {
      encoding: "utf8",
      maxBuffer: Math.max(getSpawnMaxBuffer(), 50 * 1024 * 1024), // 50MB — code-mode handles large outputs
      env: { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
    });
  } catch (error: any) {
    throw new McpError(
      ErrorCode.InternalError,
      `kubectl failed: ${error.stderr || error.message}`,
    );
  }

  const rawBytes = Buffer.byteLength(rawOutput);

  // 3. Wrap user code with DATA injection
  const wrappedCode = injectData(language, rawOutput, input.code);

  // 4. Execute in sandbox
  const result = await executor.execute({
    language,
    code: wrappedCode,
    timeout: 30_000,
  });

  // 5. Build response
  const stdout = result.stdout || "(no output — make sure your code prints to stdout)";
  const returnedBytes = Buffer.byteLength(stdout);

  const parts: string[] = [stdout];

  if (result.stderr && result.exitCode !== 0) {
    parts.push(`\nstderr: ${result.stderr}`);
  }
  if (result.timedOut) {
    parts.push("\n(script timed out after 30s)");
  }

  // Inline stat so the LLM sees the savings per call
  const kb = (b: number) => b < 1024 ? `${b}B` : `${(b / 1024).toFixed(1)}KB`;
  const pct = rawBytes > 0 ? ((1 - returnedBytes / rawBytes) * 100).toFixed(1) : "0";
  parts.push(`\n[code-mode: ${kb(rawBytes)} → ${kb(returnedBytes)} (${pct}% reduction)]`);

  return {
    content: [{ type: "text", text: parts.join("") }],
  };
}

// Split args string into array, respecting quotes
function parseArgs(argsStr: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of argsStr) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

// Inject raw kubectl output as DATA variable for each language
function injectData(language: Language, data: string, userCode: string): string {
  const escaped = JSON.stringify(data);

  switch (language) {
    case "javascript":
    case "typescript":
      return `const DATA = ${escaped};\n${userCode}`;

    case "python":
      return `import json as _json\nDATA = _json.loads(${JSON.stringify(escaped)})\n${userCode}`;

    case "shell": {
      return `DATA=$(cat <<'__K8S_CODE_MODE_EOF__'\n${data}\n__K8S_CODE_MODE_EOF__\n)\n${userCode}`;
    }

    case "ruby":
      return `DATA = ${escaped}\n${userCode}`;

    case "go":
      return `package main\n\nimport "fmt"\n\nvar DATA = ${escaped}\n\nfunc main() {\n\t_ = fmt.Sprint()\n${userCode}\n}\n`;

    case "rust":
      return `fn main() {\n    let data = ${escaped};\n${userCode}\n}\n`;

    case "php":
      return `<?php\n$DATA = ${escaped};\n${userCode}`;

    case "perl":
      return `my $DATA = ${escaped};\n${userCode}`;

    case "r":
      return `DATA <- ${escaped}\n${userCode}`;

    case "elixir":
      return `data = ${escaped}\n${userCode}`;
  }
}
