// TypeScript view of the Testfile document, mirroring schema/testfile.schema.json.

export type Scalar = string | number | boolean;
export type EnvMap = Record<string, Scalar>;
export type Duration = number | string;

export interface TestfileDoc {
  version: 0;
  name?: string;
  env?: EnvMap;
  envFile?: string | string[];
  ports?: Record<string, number | "random">;
  services?: Record<string, ServiceDef>;
  test: TestDef;
}

// Matrix variables plus the reserved exclude/include keys share one object in
// YAML; matrix.ts separates them again.
export type MatrixDef = Record<string, Scalar[] | Record<string, Scalar>[]>;

export interface TestDef {
  name?: string;
  description?: string;
  if?: string;
  tags?: string[];
  env?: EnvMap;
  envFile?: string | string[];
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
  command?: string;
  script?: string;
  shell?: string;
  sequence?: TestDef[];
  parallel?: TestDef[];
  maxParallel?: number;
  needs?: string[];
  // Resolved away by the loader (expandIncludes) before the tree is built.
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
  env?: EnvMap;
  workdir?: string;
  command?: string;
  script?: string;
  container?: ContainerDef;
  ready?: ReadyDef;
  stop?: StopDef;
}

export interface ContainerDef {
  image: string;
  engine?: "auto" | "podman" | "docker" | "kubernetes";
  ports?: string[];
  env?: EnvMap;
  volumes?: string[];
  pull?: "always" | "missing" | "never";
  network?: string;
  entrypoint?: string[];
  command?: string[];
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
