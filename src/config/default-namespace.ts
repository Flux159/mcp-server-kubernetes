/**
 * Namespace used when a tool call does not name one: K8S_NAMESPACE if set,
 * otherwise "default".
 */
export function getDefaultNamespace(): string {
  return process.env.K8S_NAMESPACE?.trim() || "default";
}
