import { spawn, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectRuntimes,
  buildCommand,
  type RuntimeMap,
  type Language,
} from "./runtime.js";

const isWin = process.platform === "win32";

function killTree(proc: ReturnType<typeof spawn>): void {
  if (isWin && proc.pid) {
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "pipe" });
    } catch { /* already dead */ }
  } else {
    proc.kill("SIGKILL");
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

interface ExecuteOptions {
  language: Language;
  code: string;
  timeout?: number;
}

export class PolyglotExecutor {
  #maxOutputBytes: number;
  #hardCapBytes: number;
  #runtimes: RuntimeMap;

  constructor(opts?: {
    maxOutputBytes?: number;
    hardCapBytes?: number;
    runtimes?: RuntimeMap;
  }) {
    this.#maxOutputBytes = opts?.maxOutputBytes ?? 102_400;
    this.#hardCapBytes = opts?.hardCapBytes ?? 100 * 1024 * 1024;
    this.#runtimes = opts?.runtimes ?? detectRuntimes();
  }

  get runtimes(): RuntimeMap {
    return { ...this.#runtimes };
  }

  async execute(opts: ExecuteOptions): Promise<ExecResult> {
    const { language, code, timeout = 30_000 } = opts;
    const tmpDir = mkdtempSync(join(tmpdir(), "k8s-code-mode-"));

    try {
      const filePath = this.#writeScript(tmpDir, code, language);
      const cmd = buildCommand(this.#runtimes, language, filePath);

      if (cmd[0] === "__rust_compile_run__") {
        return await this.#compileAndRun(filePath, tmpDir, timeout);
      }

      return await this.#spawn(cmd, tmpDir, timeout);
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch { /* OS will clean up */ }
    }
  }

  #writeScript(tmpDir: string, code: string, language: Language): string {
    const extMap: Record<Language, string> = {
      javascript: "js",
      typescript: "ts",
      python: "py",
      shell: "sh",
      ruby: "rb",
      go: "go",
      rust: "rs",
      php: "php",
      perl: "pl",
      r: "R",
      elixir: "exs",
    };

    if (language === "go" && !code.includes("package ")) {
      code = `package main\n\nimport "fmt"\n\nfunc main() {\n${code}\n}\n`;
    }

    if (language === "php" && !code.trimStart().startsWith("<?")) {
      code = `<?php\n${code}`;
    }

    const fp = join(tmpDir, `script.${extMap[language]}`);
    if (language === "shell") {
      writeFileSync(fp, code, { encoding: "utf-8", mode: 0o700 });
    } else {
      writeFileSync(fp, code, "utf-8");
    }
    return fp;
  }

  async #compileAndRun(
    srcPath: string,
    cwd: string,
    timeout: number,
  ): Promise<ExecResult> {
    const binSuffix = isWin ? ".exe" : "";
    const binPath = srcPath.replace(/\.rs$/, "") + binSuffix;

    try {
      execSync(`rustc ${srcPath} -o ${binPath}`, {
        cwd,
        timeout: Math.min(timeout, 30_000),
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? (err as any).stderr || err.message : String(err);
      return {
        stdout: "",
        stderr: `Compilation failed:\n${message}`,
        exitCode: 1,
        timedOut: false,
      };
    }

    return this.#spawn([binPath], cwd, timeout);
  }

  static smartTruncate(raw: string, max: number): string {
    if (Buffer.byteLength(raw) <= max) return raw;

    const lines = raw.split("\n");
    const headBudget = Math.floor(max * 0.6);
    const tailBudget = max - headBudget;

    const headLines: string[] = [];
    let headBytes = 0;
    for (const line of lines) {
      const lineBytes = Buffer.byteLength(line) + 1;
      if (headBytes + lineBytes > headBudget) break;
      headLines.push(line);
      headBytes += lineBytes;
    }

    const tailLines: string[] = [];
    let tailBytes = 0;
    for (let i = lines.length - 1; i >= headLines.length; i--) {
      const lineBytes = Buffer.byteLength(lines[i]) + 1;
      if (tailBytes + lineBytes > tailBudget) break;
      tailLines.unshift(lines[i]);
      tailBytes += lineBytes;
    }

    const skippedLines = lines.length - headLines.length - tailLines.length;
    const skippedBytes = Buffer.byteLength(raw) - headBytes - tailBytes;

    const separator = `\n\n... [${skippedLines} lines / ${(skippedBytes / 1024).toFixed(1)}KB truncated — showing first ${headLines.length} + last ${tailLines.length} lines] ...\n\n`;

    return headLines.join("\n") + separator + tailLines.join("\n");
  }

  async #spawn(
    cmd: string[],
    cwd: string,
    timeout: number,
  ): Promise<ExecResult> {
    return new Promise((res) => {
      const needsShell = isWin && ["tsx", "ts-node", "elixir"].includes(cmd[0]);

      const spawnCmd = cmd[0];
      const spawnArgs = isWin
        ? cmd.slice(1).map(a => a.replace(/\\/g, "/"))
        : cmd.slice(1);

      const proc = spawn(spawnCmd, spawnArgs, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: this.#buildSafeEnv(cwd),
        shell: needsShell,
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(proc);
      }, timeout);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let capExceeded = false;

      proc.stdout!.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= this.#hardCapBytes) {
          stdoutChunks.push(chunk);
        } else if (!capExceeded) {
          capExceeded = true;
          killTree(proc);
        }
      });

      proc.stderr!.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= this.#hardCapBytes) {
          stderrChunks.push(chunk);
        } else if (!capExceeded) {
          capExceeded = true;
          killTree(proc);
        }
      });

      proc.on("close", (exitCode) => {
        clearTimeout(timer);
        const rawStdout = Buffer.concat(stdoutChunks).toString("utf-8");
        let rawStderr = Buffer.concat(stderrChunks).toString("utf-8");

        if (capExceeded) {
          rawStderr += `\n[output capped at ${(this.#hardCapBytes / 1024 / 1024).toFixed(0)}MB — process killed]`;
        }

        const max = this.#maxOutputBytes;
        const stdout = PolyglotExecutor.smartTruncate(rawStdout, max);
        const stderr = PolyglotExecutor.smartTruncate(rawStderr, max);

        res({
          stdout,
          stderr,
          exitCode: timedOut ? 1 : (exitCode ?? 1),
          timedOut,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        res({
          stdout: "",
          stderr: err.message,
          exitCode: 1,
          timedOut: false,
        });
      });
    });
  }

  #buildSafeEnv(tmpDir: string): Record<string, string> {
    const realHome = process.env.HOME ?? process.env.USERPROFILE ?? tmpDir;

    const passthrough = [
      "KUBECONFIG", "K8S_CONTEXT", "K8S_NAMESPACE",
      "GH_TOKEN", "GITHUB_TOKEN",
      "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
      "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
      "SSL_CERT_FILE", "CURL_CA_BUNDLE",
      "XDG_CONFIG_HOME", "XDG_DATA_HOME",
      "SSH_AUTH_SOCK", "SSH_AGENT_PID",
    ];

    const env: Record<string, string> = {
      PATH: process.env.PATH ?? (isWin ? "" : "/usr/local/bin:/usr/bin:/bin"),
      HOME: realHome,
      TMPDIR: tmpDir,
      LANG: "en_US.UTF-8",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUNBUFFERED: "1",
      PYTHONUTF8: "1",
      NO_COLOR: "1",
    };

    if (isWin) {
      const winVars = [
        "SYSTEMROOT", "SystemRoot", "COMSPEC", "PATHEXT",
        "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
      ];
      for (const key of winVars) {
        if (process.env[key]) env[key] = process.env[key]!;
      }
    }

    for (const key of passthrough) {
      if (process.env[key]) env[key] = process.env[key]!;
    }

    return env;
  }
}
