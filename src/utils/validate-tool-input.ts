import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Runtime validation of tool arguments against each tool's inputSchema.
//
// The low-level MCP Server only validates the JSON-RPC envelope; the
// arguments object reaches the tool handlers exactly as the client sent it,
// and the handlers' TypeScript types are erased at runtime. So a value of the
// wrong type, an out-of-enum value or a missing required argument used to
// flow straight into argv construction. This checks the arguments first.
//
// The callers are usually LLMs, so every problem is reported at once, in one
// message that names the argument, what was expected and what was received,
// so the model can correct the call in a single retry.
//
// Supports the subset of JSON Schema the tool schemas use: type (including a
// list of types), enum, required, properties, items and additionalProperties.

type Schema = {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  required?: readonly string[];
  properties?: { readonly [key: string]: Schema };
  items?: Schema;
  additionalProperties?: boolean | Schema;
  default?: unknown;
  description?: string;
};

export type ToolDefinition = {
  name: string;
  inputSchema: unknown;
};

/**
 * Validate `input` against `tool.inputSchema` and return the arguments the
 * tool should run with. Throws an McpError (InvalidParams) listing every
 * problem found.
 *
 * Normalisation is limited to unambiguous cases, so a call that would have
 * worked before keeps working:
 *   - an enum value that differs only in case is replaced by the listed one
 *     ("Pod" -> "pod"); the handlers lower-case several of these anyway
 *   - a required argument that is missing but has a schema default gets the
 *     default, which is what the handlers fall back to
 *   - an optional argument passed as null is treated as omitted
 */
export function validateToolInput(
  tool: ToolDefinition,
  input: unknown
): Record<string, unknown> {
  const errors: string[] = [];

  if (input === undefined || input === null) input = {};
  if (!isPlainObject(input)) {
    throw invalid(tool.name, [
      `the arguments must be a JSON object; got ${describe(input)}.`,
    ]);
  }

  const result = validateObject(tool.inputSchema as Schema, input, "", errors);
  if (errors.length > 0) throw invalid(tool.name, errors);
  return result;
}

function validateObject(
  schema: Schema,
  value: Record<string, unknown>,
  path: string,
  errors: string[]
): Record<string, unknown> {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const result: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(value)) {
    const propSchema = properties[key];
    const propPath = join(path, key);

    // null means "not provided": dropped if optional, and reported (or
    // defaulted) by the required check below if not.
    if (raw === null) continue;

    if (propSchema) {
      result[key] = validateValue(propSchema, raw, propPath, errors);
    } else if (isPlainObject(schema.additionalProperties)) {
      result[key] = validateValue(
        schema.additionalProperties,
        raw,
        propPath,
        errors
      );
    } else if (schema.additionalProperties === false) {
      errors.push(
        `"${propPath}" is not a recognised argument. Allowed arguments: ` +
          `${listOf(Object.keys(properties))}.`
      );
    } else {
      // Unknown arguments are ignored by the handlers; pass them through.
      result[key] = raw;
    }
  }

  for (const key of required) {
    if (result[key] !== undefined && result[key] !== null) continue;
    const propSchema = properties[key];
    if (propSchema?.default !== undefined) {
      result[key] = propSchema.default;
      continue;
    }
    errors.push(missing(join(path, key), propSchema));
  }

  return result;
}

function validateValue(
  schema: Schema,
  value: unknown,
  path: string,
  errors: string[]
): unknown {
  const types = schema.type === undefined ? [] : [schema.type].flat();
  if (types.length > 0 && !types.some((t) => matchesType(t, value))) {
    errors.push(
      `"${path}" must be ${types.map(article).join(" or ")}; got ` +
        `${describe(value)}.${typeHint(types, value)}`
    );
    return value;
  }

  if (schema.enum) {
    if (schema.enum.includes(value)) return value;
    const folded =
      typeof value === "string"
        ? schema.enum.find(
            (option) =>
              typeof option === "string" &&
              option.toLowerCase() === value.toLowerCase()
          )
        : undefined;
    if (folded !== undefined) return folded;
    errors.push(
      `"${path}" must be one of ${listOf(schema.enum)}; got ${describe(value)}.`
    );
    return value;
  }

  if (Array.isArray(value) && schema.items) {
    return value.map((item, i) =>
      validateValue(schema.items!, item, `${path}[${i}]`, errors)
    );
  }

  if (isPlainObject(value) && (schema.properties || schema.required)) {
    return validateObject(schema, value, path, errors);
  }

  return value;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The most common LLM slip is quoting a scalar or JSON-encoding a structure;
// say what the fix is when that is what happened.
function typeHint(types: string[], value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (
    (types.includes("number") || types.includes("integer")) &&
    trimmed !== "" &&
    Number.isFinite(Number(trimmed))
  ) {
    return ` Pass the number without quotes: ${trimmed}.`;
  }
  if (types.includes("boolean") && (trimmed === "true" || trimmed === "false")) {
    return ` Pass the boolean without quotes: ${trimmed}.`;
  }
  if (
    (types.includes("array") && trimmed.startsWith("[")) ||
    (types.includes("object") && trimmed.startsWith("{"))
  ) {
    return " Pass the JSON value itself, not a string containing it.";
  }
  return "";
}

function missing(path: string, schema: Schema | undefined): string {
  const type = schema?.type ? ` (${[schema.type].flat().join(" or ")})` : "";
  const description = schema?.description ? `: ${schema.description}` : ".";
  return `missing required argument "${path}"${type}${description}`;
}

function invalid(toolName: string, errors: string[]): McpError {
  return new McpError(
    ErrorCode.InvalidParams,
    `Invalid arguments for tool "${toolName}":\n` +
      errors.map((e) => `  - ${e}`).join("\n") +
      `\nCorrect these arguments and call ${toolName} again.`
  );
}

function join(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function article(type: string): string {
  switch (type) {
    case "array":
      return "an array";
    case "object":
      return "an object";
    case "integer":
      return "an integer";
    default:
      return `a ${type}`;
  }
}

function listOf(values: readonly unknown[]): string {
  return values.map((v) => JSON.stringify(v)).join(", ");
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "nothing";
  const kind = Array.isArray(value)
    ? "an array"
    : typeof value === "object"
      ? "an object"
      : `a ${typeof value}`;
  let json = JSON.stringify(value) ?? String(value);
  if (json.length > 80) json = `${json.slice(0, 77)}...`;
  return `${kind} (${json})`;
}
