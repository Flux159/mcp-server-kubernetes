import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Tools hand kubectl/helm client-supplied content (manifests, patches, values)
// through a file. The shared temp directory is writable by every local user,
// so the file goes in a fresh directory of its own: mkdtemp picks an
// unpredictable name and creates it 0700, so no one else can read the file or
// stage anything at its path. The exclusive create ("wx") makes a path that
// somehow already exists an error rather than a file — or a symlink — to
// write through.

/**
 * Write `contents` to a new file named `name` inside a fresh private temp
 * directory and return the file's path. Release it with removeTempFile.
 */
export function writeTempFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-k8s-"));
  const file = path.join(dir, name);
  try {
    fs.writeFileSync(file, contents, { flag: "wx", mode: 0o600 });
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return file;
}

/**
 * Remove a file created by writeTempFile, along with its private directory.
 * Never throws: a failed cleanup is logged, not surfaced to the caller.
 */
export function removeTempFile(file: string): void {
  const dir = path.dirname(file);
  // Only ever remove a directory writeTempFile made: a caller-supplied path
  // reaching here by mistake must not take its parent directory with it.
  if (
    path.dirname(dir) !== os.tmpdir() ||
    !path.basename(dir).startsWith("mcp-k8s-")
  ) {
    console.warn(`Refusing to remove ${file}: not a writeTempFile path`);
    return;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Failed to delete temporary file ${file}: ${err}`);
  }
}
