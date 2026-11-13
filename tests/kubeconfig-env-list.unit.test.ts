import { expect, describe, test, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";

function kubeconfig(name: string, server: string): string {
  return `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: ${server}
  name: ${name}
users:
- name: ${name}
  user:
    token: ${name}-token
contexts:
- context:
    cluster: ${name}
    user: ${name}
  name: ${name}
current-context: ${name}
`;
}

describe("KUBECONFIG with several files", () => {
  const originalEnv = process.env;
  let dir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of [
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-k8s-kubeconfig-"));
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("merges every file and keeps the first current-context", () => {
    const first = path.join(dir, "prod");
    const second = path.join(dir, "staging");
    fs.writeFileSync(first, kubeconfig("prod", "https://prod.example.com"));
    fs.writeFileSync(
      second,
      kubeconfig("staging", "https://staging.example.com")
    );
    process.env.KUBECONFIG = [first, second].join(path.delimiter);

    const kc = new KubernetesManager().getKubeConfig();

    expect(kc.getContexts().map((c) => c.name)).toEqual(["prod", "staging"]);
    expect(kc.getCurrentContext()).toBe("prod");
    expect(kc.getCluster("staging")?.server).toBe(
      "https://staging.example.com"
    );
  });

  test("still loads a single file", () => {
    const only = path.join(dir, "config");
    fs.writeFileSync(only, kubeconfig("only", "https://only.example.com"));
    process.env.KUBECONFIG = only;

    const kc = new KubernetesManager().getKubeConfig();

    expect(kc.getCurrentContext()).toBe("only");
    expect(kc.getContexts().map((c) => c.name)).toEqual(["only"]);
  });
});
