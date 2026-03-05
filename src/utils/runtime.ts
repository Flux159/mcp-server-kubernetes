import { execSync } from "node:child_process";

export type Language =
  | "javascript"
  | "typescript"
  | "python"
  | "shell"
  | "ruby"
  | "go"
  | "rust"
  | "php"
  | "perl"
  | "r"
  | "elixir";

export interface RuntimeMap {
  javascript: string;
  typescript: string | null;
  python: string | null;
  shell: string;
  ruby: string | null;
  go: string | null;
  rust: string | null;
  php: string | null;
  perl: string | null;
  r: string | null;
  elixir: string | null;
}

const isWindows = process.platform === "win32";

function commandExists(cmd: string): boolean {
  try {
    const check = isWindows ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(check, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function detectRuntimes(): RuntimeMap {
  const hasBun = commandExists("bun");

  return {
    javascript: hasBun ? "bun" : "node",
    typescript: hasBun
      ? "bun"
      : commandExists("tsx")
        ? "tsx"
        : commandExists("ts-node")
          ? "ts-node"
          : null,
    python: commandExists("python3")
      ? "python3"
      : commandExists("python")
        ? "python"
        : null,
    shell: isWindows
      ? (commandExists("bash") ? "bash" : commandExists("sh") ? "sh" : "cmd.exe")
      : commandExists("bash") ? "bash" : "sh",
    ruby: commandExists("ruby") ? "ruby" : null,
    go: commandExists("go") ? "go" : null,
    rust: commandExists("rustc") ? "rustc" : null,
    php: commandExists("php") ? "php" : null,
    perl: commandExists("perl") ? "perl" : null,
    r: commandExists("Rscript")
      ? "Rscript"
      : commandExists("r")
        ? "r"
        : null,
    elixir: commandExists("elixir") ? "elixir" : null,
  };
}

export function getAvailableLanguages(runtimes: RuntimeMap): Language[] {
  const langs: Language[] = ["javascript", "shell"];
  if (runtimes.typescript) langs.push("typescript");
  if (runtimes.python) langs.push("python");
  if (runtimes.ruby) langs.push("ruby");
  if (runtimes.go) langs.push("go");
  if (runtimes.rust) langs.push("rust");
  if (runtimes.php) langs.push("php");
  if (runtimes.perl) langs.push("perl");
  if (runtimes.r) langs.push("r");
  if (runtimes.elixir) langs.push("elixir");
  return langs;
}

export function buildCommand(
  runtimes: RuntimeMap,
  language: Language,
  filePath: string,
): string[] {
  switch (language) {
    case "javascript":
      return runtimes.javascript === "bun"
        ? ["bun", "run", filePath]
        : ["node", filePath];

    case "typescript":
      if (!runtimes.typescript) {
        throw new Error("No TypeScript runtime. Install bun, tsx, or ts-node.");
      }
      if (runtimes.typescript === "bun") return ["bun", "run", filePath];
      if (runtimes.typescript === "tsx") return ["tsx", filePath];
      return ["ts-node", filePath];

    case "python":
      if (!runtimes.python) throw new Error("Python not available.");
      return [runtimes.python, filePath];

    case "shell":
      return [runtimes.shell, filePath];

    case "ruby":
      if (!runtimes.ruby) throw new Error("Ruby not available.");
      return [runtimes.ruby, filePath];

    case "go":
      if (!runtimes.go) throw new Error("Go not available.");
      return ["go", "run", filePath];

    case "rust":
      if (!runtimes.rust) throw new Error("Rust not available. Install via https://rustup.rs");
      return ["__rust_compile_run__", filePath];

    case "php":
      if (!runtimes.php) throw new Error("PHP not available.");
      return ["php", filePath];

    case "perl":
      if (!runtimes.perl) throw new Error("Perl not available.");
      return ["perl", filePath];

    case "r":
      if (!runtimes.r) throw new Error("R not available.");
      return [runtimes.r, filePath];

    case "elixir":
      if (!runtimes.elixir) throw new Error("Elixir not available.");
      return ["elixir", filePath];
  }
}
