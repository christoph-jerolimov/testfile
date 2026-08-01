// TypeScript view of the Testfile document, mirroring schema/testfile.schema.json.

export type Scalar = string | number | boolean;
export type EnvMap = Record<string, Scalar>;
export type Duration = number | string;

export interface TestfileDoc {
  version: 1;
  name?: string;
  env?: EnvMap;
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
  tags?: string[];
  env?: EnvMap;
  workdir?: string;
  timeout?: Duration;
  continueOnError?: boolean;
  services?: Record<string, ServiceDef>;
  matrix?: MatrixDef;
  command?: string;
  script?: string;
  sequence?: TestDef[];
  parallel?: TestDef[];
  maxParallel?: number;
}

export interface ServiceDef {
  description?: string;
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
  command?: string[];
}

export interface ReadyDef {
  http?: string | { url: string; method?: string; status?: number };
  tcp?: number | string | { host?: string; port: number | string };
  log?: string | { pattern: string; stream?: "stdout" | "stderr" | "any" };
  delay?: Duration;
  interval?: Duration;
  timeout?: Duration;
}

export interface StopDef {
  signal?: string;
  timeout?: Duration;
  command?: string;
}
