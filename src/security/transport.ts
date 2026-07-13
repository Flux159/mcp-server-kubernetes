// Transport-mode detection for security decisions.
//
// The server selects its transport at startup based on these env vars (see
// src/index.ts): if either is set the server listens over HTTP (SSE or
// Streamable HTTP) and serves remote clients; otherwise it uses stdio and is
// driven by a local process that already runs as the operator.
//
// Some tool inputs are only safe under the stdio trust model. A server-side
// filesystem path (e.g. `--from-file` / `-f`) is read on the machine running
// the server: over stdio that machine is the operator's own, but over HTTP it
// is the server host, so any client that can reach the endpoint could read
// arbitrary files (kubeconfig, service-account token, /proc/self/environ).
// Guards use this helper to reject path-based reads on remote transports.
export function isRemoteTransport(): boolean {
  return Boolean(
    process.env.ENABLE_UNSAFE_SSE_TRANSPORT ||
      process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT
  );
}
