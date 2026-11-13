import { expect, describe, test, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { KubernetesManager } from "../src/utils/kubernetes-manager.js";

function kubeconfig(
  name: string,
  server: string,
  {
    cluster = name,
    user = name,
    currentContext = name,
  }: { cluster?: string; user?: string; currentContext?: string } = {}
): string {
  return `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: ${server}
  name: ${cluster}
users:
- name: ${user}
  user:
    token: ${name}-token
contexts:
- context:
    cluster: ${cluster}
    user: ${user}
  name: ${name}
current-context: "${currentContext}"
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

  test("keeps the first entry when files reuse a name, like kubectl", () => {
    // kubeadm names every cluster "kubernetes" and user "kubernetes-admin"
    const shared = { cluster: "kubernetes", user: "kubernetes-admin" };
    const first = path.join(dir, "a");
    const second = path.join(dir, "b");
    fs.writeFileSync(
      first,
      kubeconfig("ctx-a", "https://a.example.com", shared)
    );
    fs.writeFileSync(
      second,
      kubeconfig("ctx-b", "https://b.example.com", shared)
    );
    process.env.KUBECONFIG = [first, second].join(path.delimiter);

    const kc = new KubernetesManager().getKubeConfig();

    expect(kc.getContexts().map((c) => c.name)).toEqual(["ctx-a", "ctx-b"]);
    expect(kc.getClusters()).toHaveLength(1);
    expect(kc.getCluster("kubernetes")?.server).toBe("https://a.example.com");
    expect(kc.getUsers().map((u) => u.name)).toEqual(["kubernetes-admin"]);
    expect(kc.getUsers()[0].token).toBe("ctx-a-token");
    expect(kc.getCurrentContext()).toBe("ctx-a");
  });

  test("skips files that do not exist, like kubectl", () => {
    const missing = path.join(dir, "missing");
    const present = path.join(dir, "config");
    fs.writeFileSync(present, kubeconfig("only", "https://only.example.com"));
    process.env.KUBECONFIG = [missing, present, missing].join(path.delimiter);

    const kc = new KubernetesManager().getKubeConfig();

    expect(kc.getContexts().map((c) => c.name)).toEqual(["only"]);
    expect(kc.getCurrentContext()).toBe("only");
  });

  test("fails clearly when no listed file exists", () => {
    process.env.KUBECONFIG = [
      path.join(dir, "missing-a"),
      path.join(dir, "missing-b"),
    ].join(path.delimiter);

    expect(() => new KubernetesManager()).toThrow(
      /None of the files listed in KUBECONFIG exist/
    );
  });

  test("takes current-context from a later file when the first sets none", () => {
    const first = path.join(dir, "prod");
    const second = path.join(dir, "staging");
    fs.writeFileSync(
      first,
      kubeconfig("prod", "https://prod.example.com", { currentContext: "" })
    );
    fs.writeFileSync(
      second,
      kubeconfig("staging", "https://staging.example.com")
    );
    process.env.KUBECONFIG = [first, second].join(path.delimiter);

    const kc = new KubernetesManager().getKubeConfig();

    expect(kc.getCurrentContext()).toBe("staging");
  });
});
