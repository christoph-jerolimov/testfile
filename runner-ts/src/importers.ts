import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { ServiceDef, TestDef } from "./model.js";

// Converters that turn files a project already has - docker-compose files,
// GitHub workflows, Makefiles, Taskfiles, justfiles - into the pieces of a
// Testfile. They are deliberately lossy and best-effort: the point is to
// get to a first green run quickly, not to translate every feature.

export interface Imported {
  // Services for the document's `services:` map.
  services: Record<string, ServiceDef>;
  // Tests for the root sequence.
  tests: TestDef[];
  // Named ports the services need (name -> "random").
  ports: Record<string, string>;
  // Human-readable notes, emitted as comments in the generated file.
  notes: string[];
}

export function emptyImport(): Imported {
  return { services: {}, tests: [], ports: {}, notes: [] };
}

// --- docker-compose -------------------------------------------------------

interface ComposeService {
  image?: string;
  build?: unknown;
  command?: string | string[];
  entrypoint?: string | string[];
  environment?: Record<string, string | number | boolean> | string[];
  ports?: (string | number)[];
  volumes?: string[];
  depends_on?: string[] | Record<string, { condition?: string }>;
  healthcheck?: { test?: string | string[]; interval?: string; start_period?: string };
  profiles?: string[];
}

function envMap(
  environment: ComposeService["environment"]
): Record<string, string> | undefined {
  if (!environment) return undefined;
  const out: Record<string, string> = {};
  if (Array.isArray(environment)) {
    for (const entry of environment) {
      const index = entry.indexOf("=");
      if (index > 0) out[entry.slice(0, index)] = entry.slice(index + 1);
    }
  } else {
    for (const [key, value] of Object.entries(environment)) out[key] = String(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// "8080:80" / "127.0.0.1:8080:80" / "80" -> the container port; the host
// side becomes a named random port so parallel runs never collide.
function containerPort(mapping: string | number): string | undefined {
  const parts = String(mapping).split(":");
  const container = parts[parts.length - 1];
  return /^\d+$/.test(container) ? container : undefined;
}

// docker-compose's healthcheck test, in either form, as a shell command.
function healthcheckCommand(test: string | string[] | undefined): string | undefined {
  if (!test) return undefined;
  if (typeof test === "string") return test;
  const [kind, ...rest] = test;
  if (kind === "CMD-SHELL") return rest.join(" ");
  if (kind === "CMD") return rest.join(" ");
  if (kind === "NONE") return undefined;
  return test.join(" ");
}

export function fromDockerCompose(text: string): Imported {
  const out = emptyImport();
  const doc = parse(text) as { services?: Record<string, ComposeService> } | null;
  const services = doc?.services ?? {};

  for (const [name, service] of Object.entries(services)) {
    if (!service || typeof service !== "object") continue;
    if (!service.image) {
      out.notes.push(
        service.build !== undefined
          ? `service "${name}" builds an image (build:) - add the built image or a command yourself`
          : `service "${name}" has no image - skipped`
      );
      if (!service.build) continue;
    }

    const def: ServiceDef = { container: { image: service.image ?? "TODO-build-your-image" } };
    const container = def.container!;

    const firstPort = (service.ports ?? []).map(containerPort).find(Boolean);
    if (firstPort) {
      out.ports[name] = "random";
      container.ports = [`\${{ ports.${name} }}:${firstPort}`];
      if ((service.ports ?? []).length > 1) {
        out.notes.push(`service "${name}" published more than one port - kept ${firstPort}`);
      }
    }
    const env = envMap(service.environment);
    if (env) container.env = env;
    if (service.volumes?.length) container.volumes = [...service.volumes];
    if (Array.isArray(service.command)) container.command = [...service.command];
    else if (typeof service.command === "string") container.command = ["sh", "-c", service.command];
    if (Array.isArray(service.entrypoint)) container.entrypoint = [...service.entrypoint];

    // depends_on becomes the runner's health-gated `needs`
    const depends = Array.isArray(service.depends_on)
      ? service.depends_on
      : Object.keys(service.depends_on ?? {});
    if (depends.length > 0) def.needs = depends;

    // healthcheck -> readiness; otherwise wait for the published port
    const health = healthcheckCommand(service.healthcheck?.test);
    if (health) {
      def.ready = { exec: health, timeout: "60s" };
      if (service.healthcheck?.interval) def.ready.interval = service.healthcheck.interval;
    } else if (firstPort) {
      def.ready = { tcp: `\${{ ports.${name} }}`, timeout: "60s" };
    } else {
      out.notes.push(`service "${name}" has no healthcheck and no ports - add a "ready" check`);
    }
    if (service.profiles?.length) {
      out.notes.push(`service "${name}" is behind compose profiles (${service.profiles.join(", ")})`);
    }
    out.services[name] = def;
  }
  return out;
}

// --- GitHub workflows -----------------------------------------------------

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  name?: string;
  steps?: WorkflowStep[];
  strategy?: { matrix?: Record<string, unknown> };
}

// Every `run:` step of every job becomes a test; `uses:` steps (checkout,
// setup-node, ...) are dropped - the runner does not manage toolchains.
export function fromGithubWorkflow(text: string): Imported {
  const out = emptyImport();
  const doc = parse(text) as { name?: string; jobs?: Record<string, WorkflowJob> } | null;
  const jobs = Object.entries(doc?.jobs ?? {});

  for (const [jobId, job] of jobs) {
    const steps = (job?.steps ?? []).filter((step) => typeof step.run === "string");
    const skipped = (job?.steps ?? []).filter((step) => step.uses).map((step) => step.uses!);
    if (skipped.length > 0) {
      out.notes.push(`job "${jobId}": dropped ${skipped.length} action step(s) (${skipped[0]}, ...)`);
    }
    if (steps.length === 0) continue;
    if (job?.strategy?.matrix) {
      out.notes.push(`job "${jobId}" uses a build matrix - see the matrix documentation`);
    }
    const tests: TestDef[] = steps.map((step, index) => ({
      name: step.name ?? `step ${index + 1}`,
      script: step.run!.trimEnd(),
    }));
    out.tests.push(
      tests.length === 1
        ? { ...tests[0], name: job?.name ?? jobId }
        : { name: job?.name ?? jobId, sequence: tests }
    );
  }
  return out;
}

// --- Make / Task / just ---------------------------------------------------

const MAKE_INTERNAL = /^(\.[A-Z]|all$|clean$)/;

// Make targets that look like checks (test/lint/check/verify/e2e/...).
export function fromMakefile(text: string): Imported {
  const out = emptyImport();
  const targets: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z0-9_.\-\/]+)\s*:(?!=)/.exec(line);
    if (!match) continue;
    const target = match[1];
    if (MAKE_INTERNAL.test(target) || targets.includes(target)) continue;
    targets.push(target);
  }
  const interesting = targets.filter((target) => /test|lint|check|verify|e2e|vet|fmt/i.test(target));
  for (const target of interesting) {
    out.tests.push({ name: target, command: `make ${target}` });
  }
  if (interesting.length === 0 && targets.length > 0) {
    out.notes.push(`Makefile has ${targets.length} target(s), none look like tests`);
  }
  return out;
}

export function fromTaskfile(text: string): Imported {
  const out = emptyImport();
  const doc = parse(text) as { tasks?: Record<string, unknown> } | null;
  for (const task of Object.keys(doc?.tasks ?? {})) {
    if (!/test|lint|check|verify|e2e/i.test(task)) continue;
    out.tests.push({ name: task, command: `task ${task}` });
  }
  return out;
}

export function fromJustfile(text: string): Imported {
  const out = emptyImport();
  for (const line of text.split("\n")) {
    // recipe headers start at column 0: "name arg='x':"
    const match = /^([A-Za-z0-9_-]+)(\s+[^:]*)?:\s*(#.*)?$/.exec(line);
    if (!match) continue;
    const recipe = match[1];
    if (!/test|lint|check|verify|e2e/i.test(recipe)) continue;
    out.tests.push({ name: recipe, command: `just ${recipe}` });
  }
  return out;
}

// --- dispatch -------------------------------------------------------------

export type ImportKind = "compose" | "workflow" | "makefile" | "taskfile" | "justfile";

export function kindOf(file: string): ImportKind | undefined {
  const name = file.replace(/\\/g, "/").split("/").pop() ?? file;
  if (/^(docker-)?compose\.ya?ml$/i.test(name)) return "compose";
  if (/^Makefile$|\.mk$/i.test(name)) return "makefile";
  if (/^Taskfile\.ya?ml$/i.test(name)) return "taskfile";
  if (/^\.?justfile$/i.test(name)) return "justfile";
  if (/\.ya?ml$/i.test(name) && /(^|\/)\.github\/workflows\//.test(file.replace(/\\/g, "/"))) {
    return "workflow";
  }
  return undefined;
}

export function importFile(file: string, kind: ImportKind = kindOf(file) ?? "compose"): Imported {
  const text = readFileSync(file, "utf8");
  switch (kind) {
    case "compose":
      return fromDockerCompose(text);
    case "workflow":
      return fromGithubWorkflow(text);
    case "makefile":
      return fromMakefile(text);
    case "taskfile":
      return fromTaskfile(text);
    case "justfile":
      return fromJustfile(text);
  }
}

export function mergeImports(parts: readonly Imported[]): Imported {
  const out = emptyImport();
  for (const part of parts) {
    Object.assign(out.services, part.services);
    Object.assign(out.ports, part.ports);
    out.tests.push(...part.tests);
    out.notes.push(...part.notes);
  }
  return out;
}
