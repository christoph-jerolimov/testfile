// TypeScript view of the Testfile document, mirroring schema/testfile.schema.json.

export type Scalar = string | number | boolean;
export type EnvMap = Record<string, Scalar>;
export type Duration = number | string;

export interface TestfileDoc {
  version: 0;
  name?: string;
  env?: EnvMap;
  envFile?: string | string[];
  // Host-env variable names/patterns forwarded into the test environment
  // (which is otherwise isolated from the host), e.g. "GITHUB_*" or "*".
  forwardEnv?: string[];
  // Names of environment variables holding secrets: forwarded from the
  // host (that is how CI secret stores hand them over) and masked in
  // recorded logs and run records.
  secrets?: string[];
  ports?: Record<string, number | "random">;
  services?: Record<string, ServiceDef>;
  test: TestDef;
}

// Matrix variables plus the reserved exclude/include keys share one object in
// YAML; matrix.ts separates them again.
export type MatrixDef = Record<string, Scalar[] | Record<string, Scalar>[]>;

// Generating one test per matching path from a template.
export interface ForeachDef {
  // Glob relative to the Testfile, e.g. "packages/*" - matches folders by
  // default, files when `file` is true.
  glob: string;
  folder?: boolean;
  file?: boolean;
  // Glob patterns of matches to skip.
  ignore?: string[];
}

export interface TestDef {
  name?: string;
  description?: string;
  if?: string;
  tags?: string[];
  env?: EnvMap;
  envFile?: string | string[];
  forwardEnv?: string[];
  // Secret environment variables for this test and its nested tests.
  secrets?: string[];
  workdir?: string;
  timeout?: Duration;
  continueOnError?: boolean;
  retry?: number | { count: number; delay?: Duration };
  services?: Record<string, ServiceDef>;
  setup?: HookDef;
  teardown?: HookDef;
  inputs?: string[];
  artifacts?: string[];
  matrix?: MatrixDef;
  // Generates one test per matching path from `template`.
  foreach?: ForeachDef | string;
  // The test generated per `foreach` match; ${{ each.* }} references the
  // match (path, name, dir, absolute).
  template?: TestDef;
  command?: string;
  script?: string;
  shell?: string;
  // Runs this test's body (and those of nested tests) inside a container.
  container?: TestContainerDef;
  sequence?: TestDef[];
  parallel?: TestDef[];
  maxParallel?: number;
  needs?: string[];
  // Resolved away by the loader (expandIncludes) before the suite is built.
  include?: string;
}

export interface HookDef {
  command?: string;
  script?: string;
  env?: EnvMap;
  workdir?: string;
  timeout?: Duration;
}

export interface ServiceDef {
  description?: string;
  shared?: boolean;
  // Names of services in the same map that must be ready before this one
  // starts (docker-compose's depends_on, but always health-gated).
  needs?: string[];
  env?: EnvMap;
  workdir?: string;
  command?: string;
  script?: string;
  container?: ContainerDef;
  ready?: ReadyDef;
  stop?: StopDef;
}

// A container a test's own body runs in (services use ContainerDef).
// Which engine runs it is the run's choice (--engine / TESTFILE_ENGINE /
// auto-detection), not the file's.
export interface TestContainerDef {
  image: string;
  env?: EnvMap;
  // Where the project is mounted (default /workspace).
  workdir?: string;
  volumes?: string[];
  pull?: "always" | "missing" | "never";
  // Container network; defaults to "host" so services stay reachable.
  network?: string;
  // Extra engine flags, e.g. "--user 1000:1000".
  options?: string[];
}

export interface ContainerDef {
  image: string;
  ports?: string[];
  env?: EnvMap;
  volumes?: string[];
  pull?: "always" | "missing" | "never";
  network?: string;
  entrypoint?: string[];
  command?: string[];
  // kubernetes engine only: which kubeconfig context / namespace to run in.
  // Both default to what kubectl would use on its own.
  context?: string;
  namespace?: string;
}

export interface ReadyDef {
  http?: string | { url: string; method?: string; status?: number };
  tcp?: number | string | { host?: string; port: number | string };
  log?: string | { pattern: string; stream?: "stdout" | "stderr" | "any" };
  exec?: string | { command: string };
  delay?: Duration;
  interval?: Duration;
  timeout?: Duration;
}

export interface StopDef {
  signal?: string;
  timeout?: Duration;
  command?: string;
}
