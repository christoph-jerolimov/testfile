import assert from "node:assert/strict";
import { test } from "node:test";
import { OutputBuffer } from "./output.js";
import { waitReady, type WaitReadyOptions } from "./ready.js";
import type { Scopes } from "./template.js";

const scopes: Scopes = {
  env: { PATH: process.env.PATH ?? "" },
  ports: { db: 55432 },
  matrix: {},
};

function options(overrides: Partial<WaitReadyOptions> = {}): WaitReadyOptions {
  return {
    output: new OutputBuffer(),
    scopes,
    signal: new AbortController().signal,
    where: 'service "db"',
    ...overrides,
  };
}

// Records what a container service was asked to run, and answers with a
// scripted sequence of results (the last one repeats).
function containerExec(results: boolean[]) {
  const seen: string[] = [];
  let call = 0;
  const run = (command: string): Promise<boolean> => {
    seen.push(command);
    return Promise.resolve(results[Math.min(call++, results.length - 1)]);
  };
  return { seen, run };
}

test("a container service's exec probe runs inside the container, templates resolved", async () => {
  const probe = containerExec([false, true]);
  await waitReady(
    { exec: "pg_isready -p ${{ ports.db }}", interval: "1ms", timeout: "2s" },
    options({ execInContainer: probe.run }),
  );
  assert.deepEqual(probe.seen, ["pg_isready -p 55432", "pg_isready -p 55432"]);
});

test("host: true sends the probe to a host shell instead of into the container", async () => {
  const probe = containerExec([false]);
  await waitReady(
    // succeeds on this machine; the container would have answered "not ready"
    { exec: { command: "exit 0", host: true }, interval: "1ms", timeout: "2s" },
    options({ execInContainer: probe.run }),
  );
  assert.deepEqual(probe.seen, [], "the container was never entered");
});

test("a service without a container has no inside, so its probe is a host shell", async () => {
  await waitReady({ exec: "exit 0", interval: "1ms", timeout: "2s" }, options());
  await assert.rejects(
    waitReady({ exec: "exit 3", interval: "1ms", timeout: "30ms" }, options()),
    /not ready after/,
  );
});

test("a probe that keeps failing inside the container fails the service", async () => {
  const probe = containerExec([false]);
  await assert.rejects(
    waitReady(
      { exec: "pg_isready", interval: "1ms", timeout: "30ms" },
      options({ execInContainer: probe.run }),
    ),
    /not ready after/,
  );
  assert.ok(probe.seen.length > 0, "the probe was attempted");
});

test("an exec attempt that throws counts as not ready rather than failing the run", async () => {
  await assert.rejects(
    waitReady(
      { exec: "pg_isready", interval: "1ms", timeout: "30ms" },
      options({ execInContainer: () => Promise.reject(new Error("engine gone")) }),
    ),
    /not ready after/,
  );
});

test("every configured check must pass, not just one", async () => {
  const probe = containerExec([false]);
  const output = new OutputBuffer();
  output.append("ready to accept connections\n", "stdout");
  await assert.rejects(
    waitReady(
      { log: "accept connections", exec: "pg_isready", interval: "1ms", timeout: "30ms" },
      options({ output, execInContainer: probe.run }),
    ),
    // the log check passed, so only the probe is named as the holdout
    /not ready after 30ms \(exec did not exit 0\)$/,
  );
});

test("the timeout names every check that was still failing, and only those", async () => {
  const output = new OutputBuffer();
  output.append("still starting up\n", "stdout");
  await assert.rejects(
    waitReady(
      {
        log: "accepting connections",
        // port 1 is privileged and never listening in a test run
        tcp: 1,
        exec: "pg_isready",
        interval: "1ms",
        timeout: "30ms",
      },
      options({ output, execInContainer: () => Promise.resolve(false) }),
    ),
    /not ready after 30ms \(tcp connect failed, log pattern not seen, exec did not exit 0\)$/,
  );
});

test("a single check still says what it was waiting for", async () => {
  await assert.rejects(
    waitReady({ tcp: 1, interval: "1ms", timeout: "30ms" }, options()),
    /not ready after 30ms \(tcp connect failed\)$/,
  );
});
