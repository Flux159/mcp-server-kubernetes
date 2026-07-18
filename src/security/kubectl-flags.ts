import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "child_process";

// Flags that would let a caller redirect kubectl to a different API server,
// substitute credentials, or impersonate another identity. Allowing any of
// these to flow in from tool inputs lets an attacker who can influence the
// LLM's tool arguments (e.g. via indirect prompt injection in pod logs)
// exfiltrate the operator's bearer token to an attacker-controlled host.
//
// Names are stored in canonical (long-form) kebab-case, without the leading
// "--". Short aliases that have the same effect are listed in SHORT_ALIASES.
const DANGEROUS_FLAGS = new Set<string>([
  // Target / endpoint overrides
  "server",
  "kubeconfig",
  "cluster",
  "context",
  "user",
  "tls-server-name",

  // TLS bypass
  "insecure-skip-tls-verify",
  "certificate-authority",
  "client-certificate",
  "client-key",

  // Credential overrides
  "token",
  "username",
  "password",
  "auth-provider",
  "auth-provider-arg",
  "exec-command",
  "exec-arg",
  "exec-api-version",
  "exec-env",

  // Identity impersonation
  "as",
  "as-group",
  "as-uid",
]);

const SHORT_ALIASES = new Set<string>([
  "s", // -s is an alias for --server
]);

// helm exposes the same exfiltration surface as kubectl, but under "kube-"
// prefixed flag names (e.g. --kube-apiserver instead of --server). We add
// those here so the argv-level guard covers helm invocations too. Context
// selection flags (--context / --kube-context) are intentionally omitted:
// they can only select a cluster already present in the loaded kubeconfig,
// every tool legitimately emits "--context <value>", and without --server /
// --kubeconfig they cannot redirect kubectl/helm to an attacker host.
const HELM_DANGEROUS_FLAGS = new Set<string>([
  "kube-apiserver",
  "kube-token",
  "kube-ca-file",
  "kube-as-user",
  "kube-as-group",
  "kube-tls-server-name",
  "kube-insecure-skip-tls-verify",
]);

// Flag names that are dangerous when they appear anywhere in a fully
// constructed argv (positional slots included), regardless of which tool
// built it. This is DANGEROUS_FLAGS minus the context-selection flags, plus
// the helm equivalents. See assertSafeArgv / execFileSyncSafe below.
const ARGV_DANGEROUS_FLAGS = new Set<string>(
  [...DANGEROUS_FLAGS, ...HELM_DANGEROUS_FLAGS].filter(
    (name) => name !== "context"
  )
);

function isUnsafeFlagsAllowed(): boolean {
  return process.env.ALLOW_KUBECTL_UNSAFE_FLAGS === "true";
}

function normalizeFlagName(raw: string): string {
  // Strip leading dashes; drop "=value" suffix; lowercase.
  let name = raw.replace(/^-+/, "");
  const eq = name.indexOf("=");
  if (eq !== -1) name = name.slice(0, eq);
  return name.toLowerCase();
}

// Extract the short-flag letter from a single-dash token, or null if the token
// is not a single-dash short flag. pflag lets a short flag carry its value
// attached with no separator ("-shttp://x" == "--server http://x"), so the
// letter that matters is always the first character after the dash; the rest of
// the token is the attached value (or a boolean-flag cluster). Long "--" flags
// never attach a value without "=", so normalizeFlagName already handles them.
function shortFlagLetter(raw: string): string | null {
  if (!raw.startsWith("-") || raw.startsWith("--")) return null;
  const body = raw.slice(1);
  if (body.length === 0) return null;
  return body[0].toLowerCase();
}

function isDangerousFlagName(rawName: string, fromArgs: boolean): boolean {
  const name = normalizeFlagName(rawName);
  if (DANGEROUS_FLAGS.has(name)) return true;
  // Short aliases (-s) are only meaningful when they appear as a CLI token,
  // not as a key in the `flags` object. Match both the bare/split forms
  // (normalizeFlagName -> "s") and the attached form "-sURL" (whose first
  // post-dash character is the flag pflag actually parses).
  if (fromArgs) {
    if (SHORT_ALIASES.has(name)) return true;
    const short = shortFlagLetter(rawName);
    if (short !== null && SHORT_ALIASES.has(short)) return true;
  }
  return false;
}

function reject(flag: string): never {
  throw new McpError(
    ErrorCode.InvalidParams,
    `Refusing to run kubectl with flag "${flag}": this flag can redirect ` +
      `kubectl to a different API server or substitute credentials, which ` +
      `would allow exfiltration of the operator's bearer token. If you ` +
      `genuinely need this flag, set ALLOW_KUBECTL_UNSAFE_FLAGS=true in the ` +
      `server environment.`
  );
}

/**
 * Validate user-supplied kubectl flags and args. Throws an McpError if any
 * dangerous flag is present and the unsafe-flags escape hatch is not set.
 *
 * The check covers:
 *   - keys of the `flags` object (e.g. { server: "..." })
 *   - tokens in the `args` array, in both joined ("--server=x") and split
 *     ("--server", "x") forms, plus short aliases ("-s").
 */
export function assertNoDangerousFlags(
  flags?: Record<string, unknown>,
  args?: string[]
): void {
  if (isUnsafeFlagsAllowed()) return;

  if (flags) {
    for (const key of Object.keys(flags)) {
      if (isDangerousFlagName(key, false)) reject(`--${normalizeFlagName(key)}`);
    }
  }

  if (args) {
    for (const tok of args) {
      if (typeof tok !== "string") continue;
      if (!tok.startsWith("-")) continue;
      if (isDangerousFlagName(tok, true)) reject(tok);
    }
  }
}

/**
 * Validate a fully-constructed kubectl/helm argv. Unlike assertNoDangerousFlags
 * (which inspects only the free-form `flags`/`args` inputs of kubectl_generic),
 * this scans every token in the final argv — including bare positional slots
 * such as resource names, node names, and resource types that the individual
 * tools push directly. kubectl's pflag parser treats any token beginning with
 * "-" as a flag regardless of position, so a tool argument like
 * name: "--server=https://attacker" would otherwise redirect the API server
 * and leak the operator's bearer token. Throws an McpError on any dangerous
 * flag unless ALLOW_KUBECTL_UNSAFE_FLAGS=true.
 */
export function assertSafeArgv(args: readonly string[]): void {
  if (isUnsafeFlagsAllowed()) return;

  for (const tok of args) {
    if (typeof tok !== "string") continue;
    if (!tok.startsWith("-")) continue;
    const name = normalizeFlagName(tok);
    if (ARGV_DANGEROUS_FLAGS.has(name) || SHORT_ALIASES.has(name)) reject(tok);
    // Attached short-flag form ("-sURL"): match the first post-dash character,
    // which is the flag pflag parses regardless of the trailing value.
    const short = shortFlagLetter(tok);
    if (short !== null && SHORT_ALIASES.has(short)) reject(tok);
  }
}

/**
 * Drop-in replacement for child_process.execFileSync that scans the argv for
 * credential/target-redirecting flags before executing. Tool files import this
 * as `execFileSync`, so every kubectl/helm call site is guarded at one place.
 */
export function execFileSyncSafe(
  file: string,
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding
): string {
  assertSafeArgv(args);
  return execFileSync(file, args, options) as string;
}
