import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

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

function isDangerousFlagName(rawName: string, fromArgs: boolean): boolean {
  const name = normalizeFlagName(rawName);
  if (DANGEROUS_FLAGS.has(name)) return true;
  // Short aliases (-s) are only meaningful when they appear as a CLI token,
  // not as a key in the `flags` object.
  if (fromArgs && SHORT_ALIASES.has(name)) return true;
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
