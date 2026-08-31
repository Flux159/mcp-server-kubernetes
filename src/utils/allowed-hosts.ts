/**
 * Shared construction of the allowedHosts list used by both HTTP transports
 * for DNS rebinding protection.
 */

// Bind addresses that mean "every interface". They are not hostnames: no
// legitimate client resolves them, so no legitimate client sends one in a Host
// header. See isAllInterfacesHost / buildDefaultAllowedHosts below.
const ALL_INTERFACES_HOSTS = new Set<string>(["0.0.0.0", "::", "::0", "0"]);

/**
 * True when `host` is an all-interfaces bind address ("0.0.0.0", "::", and the
 * bracketed IPv6 spelling).
 */
export function isAllInterfacesHost(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  return ALL_INTERFACES_HOSTS.has(bare);
}

/**
 * Build the default allowedHosts list for DNS rebinding protection.
 * Includes localhost variants with and without port.
 *
 * The configured HOST is added too, so that binding to a specific address also
 * accepts that address as a Host header — but only when it names an actual
 * interface. An all-interfaces bind ("0.0.0.0", "::") is deliberately excluded:
 * it is a bind directive, not an address a client resolves, so accepting it
 * would let any caller satisfy the allowlist by sending "Host: 0.0.0.0:<port>"
 * — a value that is public knowledge rather than a property of the deployment.
 * That would defeat the guard exactly where it matters most, since binding to
 * all interfaces is what makes the server reachable off-host in the first
 * place.
 *
 * Deployments that bind to all interfaces and need to accept a real hostname
 * (a Kubernetes Service DNS name, an ingress host) set
 * DNS_REBINDING_ALLOWED_HOST to that name; it replaces this list entirely.
 */
export function buildDefaultAllowedHosts(host: string, port: number): string[] {
  // Always allow the bare host and host:port for common localhost addresses
  const localhostAliases = ["127.0.0.1", "localhost", "::1"];
  const hosts: string[] = [];
  for (const alias of localhostAliases) {
    hosts.push(alias);
    // HTTP Host header uses bracket notation for IPv6: [::1]:3000
    if (alias.includes(":")) {
      hosts.push(`[${alias}]`);
      hosts.push(`[${alias}]:${port}`);
    } else {
      hosts.push(`${alias}:${port}`);
    }
  }
  // Also add the configured host if it's not already covered, unless it is an
  // all-interfaces bind address (see above).
  if (!localhostAliases.includes(host) && !isAllInterfacesHost(host)) {
    hosts.push(host);
    if (host.includes(":") && !host.startsWith("[")) {
      hosts.push(`[${host}]`);
      hosts.push(`[${host}]:${port}`);
    } else {
      hosts.push(`${host}:${port}`);
    }
  }
  return hosts;
}
