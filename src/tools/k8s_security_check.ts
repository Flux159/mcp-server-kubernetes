import { execSync } from 'child_process';

type Finding = {
  type: string;
  namespace: string;
  resource: string;
  details: string;
};

function runKubectl(resource: string): any {
  const cmd = `kubectl get ${resource} -A -o json`;
  const output = execSync(cmd).toString();
  return JSON.parse(output);
}

// 1. Privileged or Root Pods
function checkPrivilegedPods(): Finding[] {
  const data = runKubectl('pods');
  const findings: Finding[] = [];

  data.items.forEach((item: any) => {
    const ns = item.metadata.namespace;
    const name = item.metadata.name;
    const containers = item.spec.containers;

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
  });

  return findings;
}

// 2. Overly Permissive RBAC
function checkRbacPermissions(): Finding[] {
  const findings: Finding[] = [];

  const roles = runKubectl('roles');
  const clusterRoles = runKubectl('clusterroles');

  const scanRules = (rules: any[], name: string, kind: string, ns?: string) => {
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

  roles.items.forEach((item: any) => {
    scanRules(item.rules, item.metadata.name, 'Role', item.metadata.namespace);
  });

  clusterRoles.items.forEach((item: any) => {
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

    item.spec.containers.forEach((c: any) => {
      (c.env || []).forEach((envVar: any) => {
        if ('value' in envVar) {
          findings.push({
            type: 'Exposed Secret',
            namespace: ns,
            resource: name,
            details: `Container ${c.name} env var '${envVar.name}' contains a literal value`
          });
        }
      });
    });
  });

  return findings;
}

// 4. Missing Network Policies
function checkMissingNetworkPolicies(): Finding[] {
  const namespaces = runKubectl('namespaces');
  const netpols = runKubectl('networkpolicies');

  const nsWithNetpols = new Set(netpols.items.map((np: any) => np.metadata.namespace));
  const findings: Finding[] = [];

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

  return findings;
}

export function k8sSecurityCheck(): Finding[] {
  const results: Finding[] = [];

  results.push(...checkPrivilegedPods());
  results.push(...checkRbacPermissions());
  results.push(...checkExposedSecrets());
  results.push(...checkMissingNetworkPolicies());

  return results;
}
