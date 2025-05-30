import { execSync } from 'child_process';

type Finding = {
  type: string;
  namespace: string;
  resource: string;
  details: string;
};

// Run kubectl and return parsed JSON, or fallback to empty list
function runKubectl(resource: string): any {
  try {
    const cmd = `kubectl get ${resource} -A -o json`;
    const output = execSync(cmd).toString();
    return JSON.parse(output);
  } catch (error: any) {
    console.error(`Error fetching ${resource}:`, error.message || error);
    return { items: [] };
  }
}

// 1. Privileged or Root Pods
function checkPrivilegedPods(): Finding[] {
  const data = runKubectl('pods');
  const findings: Finding[] = [];

  data.items.forEach((item: any) => {
    const ns = item.metadata.namespace;
    const name = item.metadata.name;
    const containers = [
      ...(item.spec.containers || []),
      ...(item.spec.initContainers || [])
    ];

    containers.forEach((c: any) => {
      const ctx = c.securityContext || {};
      if (ctx.privileged || ctx.runAsNonRoot === false || ctx.runAsUser === 0) {
        findings.push({
          type: 'Privileged Pod',
          namespace: ns,
          resource: name,
          details: `Container ${c.name} is privileged or running as root`
        });
      }
    });

    // Optional: Check for hostPath volumes
    if ((item.spec.volumes || []).some((v: any) => v.hostPath)) {
      findings.push({
        type: 'HostPath Volume',
        namespace: ns,
        resource: name,
        details: 'Pod uses hostPath volume'
      });
    }
  });

  return findings;
}

// 2. Overly Permissive RBAC
function checkRbacPermissions(): Finding[] {
  const findings: Finding[] = [];
  const roles = runKubectl('roles');
  const clusterRoles = runKubectl('clusterroles');

  const excludedClusterRoles = new Set(['cluster-admin', 'admin', 'edit', 'view']);

  const scanRules = (rules: any[], name: string, kind: string, ns?: string) => {
    if (kind === 'ClusterRole' && excludedClusterRoles.has(name)) return;

    rules.forEach(rule => {
      if ((rule.verbs || []).includes('*') ||
          (rule.resources || []).includes('*') ||
          (rule.apiGroups || []).includes('*')) {
        findings.push({
          type: 'Permissive RBAC',
          namespace: ns || 'cluster-wide',
          resource: `${kind}/${name}`,
          details: 'Contains wildcard permissions'
        });
      }
    });
  };

  (roles.items || []).forEach((item: any) => {
    scanRules(item.rules, item.metadata.name, 'Role', item.metadata.namespace);
  });

  (clusterRoles.items || []).forEach((item: any) => {
    scanRules(item.rules, item.metadata.name, 'ClusterRole');
  });

  return findings;
}

// 3. Secrets in Env Vars
function checkExposedSecrets(): Finding[] {
  const data = runKubectl('pods');
  const findings: Finding[] = [];

  data.items.forEach((item: any) => {
    const ns = item.metadata.namespace;
    const name = item.metadata.name;

    const containers = [
      ...(item.spec.containers || []),
      ...(item.spec.initContainers || [])
    ];

    containers.forEach((c: any) => {
      (c.env || []).forEach((envVar: any) => {
        if ('value' in envVar && /secret|token|key|password/i.test(envVar.name)) {
          findings.push({
            type: 'Exposed Secret',
            namespace: ns,
            resource: name,
            details: `Container ${c.name} env var '${envVar.name}' may contain sensitive data`
          });
        }
      });
    });
  });

  return findings;
}

// 4. Missing or Unrestricted Network Policies
function checkNetworkPolicies(): Finding[] {
  const findings: Finding[] = [];
  const namespaces = runKubectl('namespaces');
  const netpols = runKubectl('networkpolicies');

  const nsWithNetpols = new Set(netpols.items.map((np: any) => np.metadata.namespace));

  // Namespaces without any NetworkPolicy
  namespaces.items.forEach((ns: any) => {
    const nsName = ns.metadata.name;
    if (!nsWithNetpols.has(nsName)) {
      findings.push({
        type: 'Missing NetworkPolicy',
        namespace: nsName,
        resource: 'Namespace',
        details: 'No network policy present'
      });
    }
  });

  // Network policies with open ingress and egress
  netpols.items.forEach((np: any) => {
    const ns = np.metadata.namespace;
    const name = np.metadata.name;
    const spec = np.spec;

    const allowsAllIngress = !spec.ingress || spec.ingress.length === 0;
    const allowsAllEgress = !spec.egress || spec.egress.length === 0;

    if (allowsAllIngress && allowsAllEgress) {
      findings.push({
        type: 'Unrestricted NetworkPolicy',
        namespace: ns,
        resource: name,
        details: 'Policy allows all ingress and egress traffic'
      });
    }
  });

  return findings;
}

// Aggregate security check results
export function k8sSecurityCheck(): Finding[] {
  const results: Finding[] = [];

  results.push(...checkPrivilegedPods());
  results.push(...checkRbacPermissions());
  results.push(...checkExposedSecrets());
  results.push(...checkNetworkPolicies());

  return results;
}
