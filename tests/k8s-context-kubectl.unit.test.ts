import { expect, describe, test, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as k8s from "@kubernetes/client-node";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";

/**
 * K8S_CONTEXT switches the context of the in-process client, but most tools
 * run kubectl or helm, which read the kubeconfig files on their own. The
 * override has to show up in the KUBECONFIG those child processes get,
 * otherwise they act on the file's current-context instead.
 */

const twoContexts = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://dev.example.com
  name: dev
- cluster:
    server: https://prod.example.com
  name: prod
users:
- name: admin
  user:
    token: secret
contexts:
- context:
    cluster: dev
    user: admin
  name: dev
- context:
    cluster: prod
    user: admin
  name: production
current-context: dev
`;

// Resolve the context the way kubectl does: the first file in the list that
// sets current-context wins.
function kubectlCurrentContext(): string {
  for (const file of process.env.KUBECONFIG!.split(path.delimiter)) {
    if (!fs.existsSync(file)) {
      continue;
    }
    const kc = new k8s.KubeConfig();
    kc.loadFromFile(file);
    if (kc.getCurrentContext()) {
      return kc.getCurrentContext();
    }
  }
  return "";
}

describe("K8S_CONTEXT reaches kubectl and helm", () => {
  const originalEnv = process.env;
  let dir: string;
  let kubeconfigPath: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of [
      "KUBECONFIG",
      "KUBECONFIG_YAML",
      "KUBECONFIG_JSON",
      "K8S_SERVER",
      "K8S_TOKEN",
      "KUBECONFIG_PATH",
      "K8S_CONTEXT",
      "KUBERNETES_SERVICE_HOST",
      "KUBERNETES_SERVICE_PORT",
    ]) {
      delete process.env[key];
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-k8s-context-"));
    kubeconfigPath = path.join(dir, "config");
    fs.writeFileSync(kubeconfigPath, twoContexts);
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("with KUBECONFIG", () => {
    process.env.KUBECONFIG = kubeconfigPath;
    process.env.K8S_CONTEXT = "production";

    const manager = new KubernetesManager();

    expect(manager.getKubeConfig().getCurrentContext()).toBe("production");
    expect(kubectlCurrentContext()).toBe("production");
    expect(process.env.KUBECONFIG!.split(path.delimiter).slice(1)).toEqual([
      kubeconfigPath,
    ]);
    expect(fs.readFileSync(kubeconfigPath, "utf8")).toBe(twoContexts);
  });

  test("with KUBECONFIG_PATH", () => {
    process.env.KUBECONFIG_PATH = kubeconfigPath;
    process.env.K8S_CONTEXT = "production";

    new KubernetesManager();

    expect(kubectlCurrentContext()).toBe("production");
  });

  test("with KUBECONFIG_YAML", () => {
    process.env.KUBECONFIG_YAML = twoContexts;
    process.env.K8S_CONTEXT = "production";

    new KubernetesManager();

    expect(kubectlCurrentContext()).toBe("production");
  });

  test("without K8S_CONTEXT the file's context is kept", () => {
    process.env.KUBECONFIG = kubeconfigPath;

    new KubernetesManager();

    expect(process.env.KUBECONFIG).toBe(kubeconfigPath);
    expect(kubectlCurrentContext()).toBe("dev");
  });

  test("an unknown K8S_CONTEXT leaves KUBECONFIG alone", () => {
    process.env.KUBECONFIG = kubeconfigPath;
    process.env.K8S_CONTEXT = "missing";

    new KubernetesManager();

    expect(process.env.KUBECONFIG).toBe(kubeconfigPath);
  });
});
