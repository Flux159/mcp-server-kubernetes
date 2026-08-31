import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "child_process";
import { isRemoteTransport } from "./transport.js";

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

  // Writes to attacker-chosen filesystem paths
  "profile-output",
  "log-file",
  "cache-dir",
]);

const SHORT_ALIASES = new Set<string>([
  "s", // -s is an alias for --server
]);

// Short flags that consume a value. pflag stops parsing a shorthand cluster at
// the first of these: everything after it inside the token is that flag's
// value ("-ojsonpath={.items[0]}"), not more flags. Every other letter is a
// boolean shorthand, which pflag parses and then keeps going past — so the
// scan in shortFlagLetters() must keep going too.
//
// Comparison is case-sensitive, exactly like pflag: "-A" (--all-namespaces)
// and "-a" are different flags.
//
// Only letters that take a value in *every* command that defines them belong
// here. "-f" is deliberately absent: it is --filename for apply/delete but the
// boolean --follow for logs, so pflag keeps parsing the cluster after it.
// Leaving a letter out is always the safe direction — at worst an attached
// value containing "s" is refused, and the split form ("-f /path") or the long
// form ("--filename=/path") still works.
const SHORT_VALUE_FLAGS = new Set<string>([
  "c", // --container
  "k", // --kustomize
  "l", // --selector
  "L", // --label-columns
  "n", // --namespace
  "o", // --output
  "s", // --server (dangerous; listed so the scan stops after it as well)
  "v", // --v (log level)
]);

// helm exposes the same exfiltration surface as kubectl, but under "kube-"
// prefixed flag names (e.g. --kube-apiserver instead of --server), plus a few
// helm-only flags that run or overwrite things on the MCP server host. We add
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

  // Runs a binary on the MCP server host: helm 3.x resolves --post-renderer to
  // an executable path (or a $PATH name) and runs it over the rendered
  // manifests. Nothing about installing a chart otherwise gives host-side
  // execution, so this is never a flag a tool should emit.
  "post-renderer",
  "post-renderer-args",

  // Writes to attacker-chosen filesystem paths: helm rewrites these files as
  // part of "repo add" / registry login.
  "repository-config",
  "registry-config",
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

// Flags that make kubectl read a file from the machine it is running on.
//
// These are not in DANGEROUS_FLAGS: under stdio that machine is the operator's
// own, and "-f manifest.yaml" is the whole point of the tool. They only become
// a vulnerability on a remote (SSE / Streamable HTTP) transport, where the path
// is chosen by a client but resolved on the server host — so they are rejected
// by transport, in assertNoRemoteFileReads, rather than denied outright.
//
// Long names only; the single-dash spellings live in FILE_READ_SHORT_FLAGS.
const FILE_READ_FLAGS = new Set<string>([
  "filename",
  "from-file",
  "from-env-file",
  "kustomize",
  "patch-file",
]);

// Single-letter spellings of the above. Unlike SHORT_ALIASES these are checked
// against every letter pflag would parse out of a shorthand cluster, so the
// attached ("-f/etc/passwd") and clustered ("-Rf/etc/passwd") forms are caught
// alongside the split one ("-f", "/etc/passwd").
const FILE_READ_SHORT_FLAGS = new Set<string>([
  "f", // --filename
  "k", // --kustomize
]);

// Output formats whose argument is a file path on the machine kubectl runs on:
// "-o go-template-file=<path>" makes kubectl read that file and render it into
// the result. That is the same read as --from-file under a different flag
// name, but unlike --from-file no tool here ever legitimately emits one — so
// assertSafeArgv refuses them in any argv, on any transport, rather than only
// where a server-side path would be attacker-chosen. Every tool has positional
// slots, read-only ones included, so a name-shaped denial is not enough.
const FILE_READ_OUTPUT_FORMATS = new Set<string>([
  "go-template-file",
  "jsonpath-file",
  "custom-columns-file",
]);

function isUnsafeFlagsAllowed(): boolean {
  return process.env.ALLOW_KUBECTL_UNSAFE_FLAGS === "true";
}

function normalizeFlagName(raw: string): string {
  // Strip leading dashes; drop "=value" suffix; lowercase.
  let name = raw.replace(/^-+/, "");
  const eq = name.indexOf("=");
  if (eq !== -1) name = name.slice(0, eq);
  // kubectl and helm install pflag's WordSepNormalizeFunc, which treats "_" as
  // equivalent to "-" in long flag names: "--insecure_skip_tls_verify" and
  // "--insecure-skip-tls-verify" are the same flag. Normalize the same way so
  // both spellings compare equal against the sets above.
  return name.toLowerCase().replace(/_/g, "-");
}

// Return every letter pflag would parse as a flag out of a single-dash token,
// in order, or null if the token is not a single-dash short flag.
//
// pflag walks a shorthand cluster letter by letter: a boolean shorthand is
// consumed and parsing continues with the next letter, while a value-taking
// shorthand swallows the remainder of the token as its value. "-Aowide" is
// therefore "-A -o wide", not a single unknown flag, so every letter pflag
// reaches has to be checked — not just the first one after the dash.
//
// Long "--" flags never attach a value without "=", so normalizeFlagName
// already handles them.
function shortFlagLetters(raw: string): string[] | null {
  if (!raw.startsWith("-") || raw.startsWith("--")) return null;
  const body = raw.slice(1);
  if (body.length === 0) return null;

  const letters: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const letter = body[i];
    letters.push(letter);
    // "-o=json": the "=" and everything after it is the value.
    if (body[i + 1] === "=") break;
    // A value-taking shorthand consumes the rest of the token as its value,
    // so no further letters are parsed as flags.
    if (SHORT_VALUE_FLAGS.has(letter)) break;
  }
  return letters;
}

function hasDangerousShortFlag(raw: string): boolean {
  const letters = shortFlagLetters(raw);
  if (letters === null) return false;
  return letters.some((letter) => SHORT_ALIASES.has(letter));
}

function isDangerousFlagName(rawName: string, fromArgs: boolean): boolean {
  const name = normalizeFlagName(rawName);
  if (DANGEROUS_FLAGS.has(name)) return true;
  // Short aliases (-s) are only meaningful when they appear as a CLI token,
  // not as a key in the `flags` object. Match both the bare/split forms
  // (normalizeFlagName -> "s") and the attached/clustered forms ("-sURL",
  // "-Ashttps://attacker"), where pflag parses the alias out of the cluster.
  if (fromArgs) {
    if (SHORT_ALIASES.has(name)) return true;
    if (hasDangerousShortFlag(rawName)) return true;
  }
  return false;
}

function reject(flag: string): never {
  throw new McpError(
    ErrorCode.InvalidParams,
    `Refusing to run kubectl with flag "${flag}": this flag can redirect ` +
      `kubectl/helm to a different API server, substitute credentials, or ` +
      `act on the MCP server's own host, which would allow exfiltration of ` +
      `the operator's bearer token. If you genuinely need this flag, set ` +
      `ALLOW_KUBECTL_UNSAFE_FLAGS=true in the server environment.`
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

  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (typeof tok !== "string") continue;
    if (!tok.startsWith("-")) continue;
    const name = normalizeFlagName(tok);
    if (ARGV_DANGEROUS_FLAGS.has(name) || SHORT_ALIASES.has(name)) reject(tok);
    // Attached/clustered short-flag forms ("-sURL", "-Ashttps://attacker"):
    // match every letter pflag would parse out of the cluster, not just the
    // first one.
    if (hasDangerousShortFlag(tok)) reject(tok);
    // A file read hiding in the *value* of an otherwise ordinary flag
    // ("-o go-template-file=<path>"), so it has to be matched on the value
    // rather than on the flag name.
    const format = outputFormatValue(tok, args[i + 1]);
    if (
      format !== undefined &&
      FILE_READ_OUTPUT_FORMATS.has(format.split("=")[0])
    ) {
      rejectOutputFileRead(tok, format);
    }
  }
}

/**
 * Return the value kubectl would take for -o / --output in `tok`, or undefined
 * if `tok` is not an output flag. The value may be attached to the token
 * ("-ojson", "-o=json", "--output=json") or sit in the following one, which is
 * why the caller passes `next`.
 */
function outputFormatValue(
  tok: string,
  next: string | undefined
): string | undefined {
  if (tok.startsWith("--")) {
    if (normalizeFlagName(tok) !== "output") return undefined;
    const eq = tok.indexOf("=");
    return eq === -1 ? next : tok.slice(eq + 1);
  }

  const letters = shortFlagLetters(tok);
  if (letters === null) return undefined;
  const idx = letters.indexOf("o");
  if (idx === -1) return undefined;

  // "o" takes a value, so pflag stops the cluster there and reads the rest of
  // the token as the format ("-Aojson" -> "-A -o json"). An empty remainder
  // means the format is the next argv token instead.
  let rest = tok.slice(1 + idx + 1);
  if (rest.startsWith("=")) rest = rest.slice(1);
  return rest === "" ? next : rest;
}

function rejectOutputFileRead(tok: string, format: string): never {
  throw new McpError(
    ErrorCode.InvalidParams,
    `Refusing to run kubectl with "${tok} ${format}": this output format ` +
      `takes a file path and makes kubectl read that file from the MCP ` +
      `server's own filesystem, rendering it into the result. No tool needs ` +
      `it, and a resource name or type that parses as this flag is an ` +
      `injection attempt. Use an inline template ("-o go-template=...") or a ` +
      `jsonpath expression instead.`
  );
}

function rejectFileRead(flag: string): never {
  throw new McpError(
    ErrorCode.InvalidParams,
    `Refusing to run kubectl with "${flag}": this flag reads a file from the ` +
      `MCP server's own filesystem, which is disabled on remote (SSE/` +
      `Streamable HTTP) transports because the path is chosen by the client ` +
      `but resolved on the server host. Pass the file contents inline ` +
      `instead (kubectl_apply/kubectl_create "manifest", kubectl_create ` +
      `"fromFileContent", or install_helm_chart "values").`
  );
}

/**
 * Reject flags that make kubectl read a file from the MCP server's filesystem,
 * on remote transports only. No-op under stdio.
 *
 * kubectl_generic lets a caller assemble an arbitrary kubectl argv, so the
 * per-parameter guards the structured tools use (`filename`, `fromFile`,
 * `patchFile`, `valuesFile`) have nothing to attach to: the same read is
 * reachable as a raw "--from-file=leak=/etc/passwd" token. Under stdio that is
 * the operator reading their own files and stays allowed; over SSE/Streamable
 * HTTP the path comes from whoever can reach the endpoint but resolves on the
 * server host, turning kubectl into an arbitrary file-read oracle (kubeconfig,
 * service-account token, /proc/self/environ) — with --dry-run=client, without
 * even a cluster.
 *
 * Takes a fully-constructed argv rather than the `flags`/`args` inputs so that
 * flags built from the object form and file-shaped values smuggled through
 * positional slots (resourceType, name) are covered by the same scan. Unlike
 * assertNoDangerousFlags there is no ALLOW_KUBECTL_UNSAFE_FLAGS escape hatch:
 * this mirrors the transport guards in the structured tools, which reject
 * server-side paths unconditionally.
 */
export function assertNoRemoteFileReads(args: readonly string[]): void {
  if (!isRemoteTransport()) return;

  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (typeof tok !== "string" || !tok.startsWith("-")) continue;

    if (FILE_READ_FLAGS.has(normalizeFlagName(tok))) rejectFileRead(tok);

    // Short spellings, including the attached and clustered forms pflag
    // accepts: "-f/etc/passwd", "-Rf/etc/passwd".
    const letters = shortFlagLetters(tok);
    if (letters?.some((letter) => FILE_READ_SHORT_FLAGS.has(letter))) {
      rejectFileRead(tok);
    }
  }
}

/**
 * Reject a caller-supplied value that a tool is about to place in a *positional*
 * argv slot (a resource type, a resource name, a release name, a chart
 * reference, a namespace) when it is shaped like a command-line flag.
 *
 * assertSafeArgv is a deny-list: it can only refuse the flags it knows about,
 * so every dangerous flag added upstream is exploitable through any positional
 * slot until the list is extended. This guard closes the injection point
 * instead of chasing the flags: pflag treats any token starting with "-" as a
 * flag no matter where it sits, and none of these operands is ever legitimately
 * flag-shaped (Kubernetes resource types and names, helm release names and
 * namespaces are RFC 1123 names; chart references are repo/name pairs, paths
 * or URLs). Refusing a leading "-" here means caller data can never occupy a
 * slot where it would be parsed as a flag.
 *
 * Honours the same ALLOW_KUBECTL_UNSAFE_FLAGS escape hatch as the flag guard.
 */
export function assertNotFlagLike(
  value: string | undefined,
  field: string
): void {
  if (isUnsafeFlagsAllowed()) return;
  if (typeof value !== "string" || !value.startsWith("-")) return;

  throw new McpError(
    ErrorCode.InvalidParams,
    `Refusing to run kubectl/helm with ${field}="${value}": a value ` +
      `starting with "-" is parsed as a command-line flag rather than as ` +
      `the ${field}, which would let the caller inject arbitrary flags. ` +
      `Provide a ${field} that does not begin with "-".`
  );
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
