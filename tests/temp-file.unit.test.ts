import { expect, test, describe } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { removeTempFile, writeTempFile } from "../src/utils/temp-file.js";

describe("writeTempFile", () => {
  test("writes into a fresh private directory under the temp dir", () => {
    const file = writeTempFile("manifest.yaml", "kind: ConfigMap\n");
    try {
      const dir = path.dirname(file);
      expect(path.dirname(dir)).toBe(os.tmpdir());
      expect(path.basename(dir)).toMatch(/^mcp-k8s-/);
      expect(path.basename(file)).toBe("manifest.yaml");
      expect(fs.readFileSync(file, "utf8")).toBe("kind: ConfigMap\n");
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      removeTempFile(file);
    }
  });

  test("never reuses a path, so nothing can be staged at it in advance", () => {
    const a = writeTempFile("values.yaml", "a");
    const b = writeTempFile("values.yaml", "b");
    try {
      expect(a).not.toBe(b);
      expect(fs.readFileSync(a, "utf8")).toBe("a");
      expect(fs.readFileSync(b, "utf8")).toBe("b");
    } finally {
      removeTempFile(a);
      removeTempFile(b);
    }
  });
});

describe("removeTempFile", () => {
  test("removes the file and its directory", () => {
    const file = writeTempFile("patch.json", "{}");
    removeTempFile(file);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });

  test("leaves paths it did not create alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "not-ours-"));
    const file = path.join(dir, "keep.txt");
    fs.writeFileSync(file, "keep");
    try {
      removeTempFile(file);
      expect(fs.readFileSync(file, "utf8")).toBe("keep");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
