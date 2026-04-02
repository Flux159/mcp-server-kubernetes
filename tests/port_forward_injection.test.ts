import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import * as child_process from "child_process";
import { EventEmitter } from "events";

// We'll test that executeKubectlPortForward (the refactored function) passes
// arguments as discrete array elements to spawn, so user input containing
// spaces does NOT split into extra arguments.

// Mock spawn to capture its invocations
vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof child_process>("child_process");
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

// Import after mocking
import { startPortForward } from "../src/tools/port_forward.js";

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 12345;
  return proc;
}

function createMockK8sManager() {
  return {
    trackPortForward: vi.fn(),
    getPortForward: vi.fn(),
    removePortForward: vi.fn(),
  } as any;
}

describe("port_forward argument injection prevention", () => {
  let spawnMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    spawnMock = vi.mocked(child_process.spawn);
    spawnMock.mockReset();
  });

  test("resourceName with spaces should be passed as a single argument, not split", async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const k8sManager = createMockK8sManager();
    const maliciousName = "myresource --kubeconfig /tmp/evil";

    const promise = startPortForward(k8sManager, {
      resourceType: "pod",
      resourceName: maliciousName,
      localPort: 8080,
      targetPort: 80,
    });

    // Simulate successful forwarding
    setTimeout(() => {
      proc.stdout.emit("data", "Forwarding from 127.0.0.1:8080 -> 80");
    }, 10);

    await promise;

    // Verify spawn was called
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe("kubectl");

    // The resource argument should be a single element containing the slash
    // and the full (malicious) name — NOT split on spaces
    const resourceArg = args.find((a: string) =>
      a.startsWith("pod/")
    );
    expect(resourceArg).toBe(`pod/${maliciousName}`);

    // There must NOT be a "--kubeconfig" argument injected
    expect(args).not.toContain("--kubeconfig");
    expect(args).not.toContain("/tmp/evil");
  });

  test("namespace with spaces should be passed as a single argument, not split", async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const k8sManager = createMockK8sManager();
    const maliciousNamespace = "default --kubeconfig /tmp/evil";

    const promise = startPortForward(k8sManager, {
      resourceType: "pod",
      resourceName: "nginx",
      localPort: 8080,
      targetPort: 80,
      namespace: maliciousNamespace,
    });

    setTimeout(() => {
      proc.stdout.emit("data", "Forwarding from 127.0.0.1:8080 -> 80");
    }, 10);

    await promise;

    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe("kubectl");

    // The namespace should be passed as a single arg after -n
    const nIndex = args.indexOf("-n");
    expect(nIndex).toBeGreaterThanOrEqual(0);
    expect(args[nIndex + 1]).toBe(maliciousNamespace);

    // There must NOT be injected arguments
    expect(args).not.toContain("--kubeconfig");
    expect(args).not.toContain("/tmp/evil");
  });

  test("resourceType with spaces should be passed as a single argument, not split", async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const k8sManager = createMockK8sManager();
    const maliciousType = "pod --kubeconfig /tmp/evil";

    const promise = startPortForward(k8sManager, {
      resourceType: maliciousType,
      resourceName: "nginx",
      localPort: 8080,
      targetPort: 80,
    });

    setTimeout(() => {
      proc.stdout.emit("data", "Forwarding from 127.0.0.1:8080 -> 80");
    }, 10);

    await promise;

    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe("kubectl");

    // The resource arg should contain the malicious type unsplit
    const resourceArg = args.find((a: string) =>
      a.includes("/nginx")
    );
    expect(resourceArg).toBe(`${maliciousType}/nginx`);

    // Injected flags must not be present as separate args
    expect(args).not.toContain("--kubeconfig");
    expect(args).not.toContain("/tmp/evil");
  });

  test("normal input should produce correct arguments", async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const k8sManager = createMockK8sManager();

    const promise = startPortForward(k8sManager, {
      resourceType: "pod",
      resourceName: "nginx",
      localPort: 8080,
      targetPort: 80,
      namespace: "production",
    });

    setTimeout(() => {
      proc.stdout.emit("data", "Forwarding from 127.0.0.1:8080 -> 80");
    }, 10);

    await promise;

    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe("kubectl");
    expect(args).toEqual([
      "port-forward",
      "-n",
      "production",
      "pod/nginx",
      "8080:80",
    ]);
  });
});
