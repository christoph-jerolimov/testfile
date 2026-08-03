import { resolve as resolvePath } from "node:path";
import type { TestContainerDef } from "./model.js";
import { detectEngine } from "./services.js";
import { resolveEnvMap, resolveTemplate, type Scopes } from "./template.js";

// Running a test's body inside a container (like a GitHub Actions job
// container): the project is mounted, the working directory is the mounted
// path, and the shell command runs through `<engine> run --rm`. Services
// stay outside - they are reached over published ports on the host, which
// is why the container joins the host network unless told otherwise.

export const DEFAULT_WORKDIR = "/workspace";

export interface TestContainerPlan {
  engine: string;
  args: string[];
  // Where the project is mounted inside the container.
  workdir: string;
}

// Builds the `run` invocation for a test body. `hostCwd` is the directory
// the test would have run in on the host; it becomes the mount source and
// the container's working directory.
export function buildTestContainerArgs(
  def: TestContainerDef,
  hostCwd: string,
  projectDir: string,
  env: Record<string, string>,
  scopes: Scopes,
  where: string,
  shellArgv: string[]
): TestContainerPlan {
  const engine =
    def.engine && def.engine !== "auto" ? def.engine : detectEngine();
  if (engine === "kubernetes") {
    throw new Error(`${where}: container engine "kubernetes" is reserved for a future version`);
  }

  // The whole project is mounted, not just the test's workdir, so relative
  // paths that reach outside it (a monorepo's root config) still resolve.
  const mountSource = resolvePath(projectDir);
  const mountTarget = def.workdir ? resolveTemplate(def.workdir, scopes, where) : DEFAULT_WORKDIR;
  const relative = resolvePath(hostCwd).slice(mountSource.length).replace(/\\/g, "/");
  const workdir = `${mountTarget}${relative}`;

  const args = ["run", "--rm", "-i"];
  if (def.pull) args.push(`--pull=${def.pull}`);
  // Host networking by default: a test reaches its services on 127.0.0.1
  // exactly like it would outside the container.
  const network = def.network ? resolveTemplate(def.network, scopes, where) : "host";
  args.push("--network", network);
  args.push("-v", `${mountSource}:${mountTarget}`);
  for (const volume of def.volumes ?? []) {
    args.push("-v", resolveTemplate(volume, scopes, where));
  }
  args.push("-w", workdir);

  // The test's resolved environment, minus host paths that mean nothing
  // inside the container.
  for (const [key, value] of Object.entries(env)) {
    if (SKIPPED_ENV.has(key)) continue;
    args.push("-e", `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(resolveEnvMap(def.env, scopes, where))) {
    args.push("-e", `${key}=${value}`);
  }
  for (const option of def.options ?? []) {
    args.push(...resolveTemplate(option, scopes, where).split(/\s+/).filter(Boolean));
  }
  args.push("--entrypoint", shellArgv[0]);
  args.push(resolveTemplate(def.image, scopes, where));
  args.push(...shellArgv.slice(1));
  return { engine, args, workdir };
}

// Host-specific variables that would be wrong or misleading inside the
// container; the image provides its own.
const SKIPPED_ENV = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USER",
  "LOGNAME",
  "XDG_RUNTIME_DIR",
  "PWD",
  "OLDPWD",
]);
