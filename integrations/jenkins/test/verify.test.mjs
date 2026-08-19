// verify.mjs against a stubbed Jenkins: the REST flow it depends on -
// crumb + session cookie, build trigger, queue polling, build result,
// test report, artifacts - served by a few dozen lines of node:http. What
// the stub answers is shaped like Jenkins' own API answers, so a change to
// verify.mjs that would misread the real thing fails here, in milliseconds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VERIFY = join(dirname(fileURLToPath(import.meta.url)), "verify.mjs");

// One job's stubbed behaviour: the build result, the test report (null for
// "none recorded") and the archived artifacts.
function stubJenkins(jobs) {
  const queued = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const reply = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const base = `http://127.0.0.1:${server.address().port}`;

    if (url.pathname === "/crumbIssuer/api/json") {
      return reply(
        200,
        { crumb: "stub-crumb", crumbRequestField: "Jenkins-Crumb" },
        { "set-cookie": "JSESSIONID.stub=abc; Path=/; HttpOnly" },
      );
    }
    const build = /^\/job\/([^/]+)\/build$/.exec(url.pathname);
    if (build && req.method === "POST") {
      // What Jenkins enforces, the stub enforces: no crumb or no session
      // cookie means the trigger must fail.
      if (
        req.headers["jenkins-crumb"] !== "stub-crumb" ||
        !req.headers.cookie?.includes("JSESSIONID.stub")
      ) {
        return reply(403, { message: "no valid crumb" });
      }
      if (!jobs[build[1]]) return reply(404, {});
      const item = queued.size + 1;
      queued.set(item, build[1]);
      return reply(201, "", { location: `${base}/queue/item/${item}/` });
    }
    const queue = /^\/queue\/item\/(\d+)\/api\/json$/.exec(url.pathname);
    if (queue && queued.has(Number(queue[1]))) {
      return reply(200, { executable: { url: `${base}/job/${queued.get(Number(queue[1]))}/1/` } });
    }
    const one = /^\/job\/([^/]+)\/1\/(.*)$/.exec(url.pathname);
    if (one) {
      const job = jobs[one[1]];
      if (!job) return reply(404, {});
      if (one[2] === "api/json") {
        return reply(200, { building: false, result: job.result, artifacts: job.artifacts ?? [] });
      }
      if (one[2] === "testReport/api/json") {
        return job.report ? reply(200, job.report) : reply(404, {});
      }
      if (one[2] === "consoleText") return reply(200, "stub console output\n");
    }
    reply(404, {});
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// The three jobs behaving the way verify.mjs expects them to; each failure
// case breaks exactly one of them.
const GOOD = {
  "testfile-smoke": {
    result: "SUCCESS",
    report: { passCount: 2, failCount: 0, skipCount: 0 },
    artifacts: [{ relativePath: ".testfile/runs/r-1/run.yaml" }],
  },
  "testfile-filtered": { result: "SUCCESS", report: { passCount: 1, failCount: 0, skipCount: 0 } },
  "testfile-failing": { result: "FAILURE", report: { passCount: 1, failCount: 1, skipCount: 0 } },
};

function runVerify(port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VERIFY], {
      cwd: mkdtempSync(join(tmpdir(), "verify-test-")),
      env: { ...process.env, JENKINS_URL: `http://127.0.0.1:${port}`, JENKINS_VERSION: "stub" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => resolve({ code, output }));
  });
}

test("a Jenkins where every job behaves passes verification", async () => {
  const server = await stubJenkins(GOOD);
  try {
    const { code, output } = await runVerify(server.address().port);
    assert.equal(code, 0, output);
    assert.match(output, /all 3 jobs verified/);
  } finally {
    server.close();
  }
});

test("a wrong verdict fails verification", async () => {
  const server = await stubJenkins({
    ...GOOD,
    "testfile-smoke": { ...GOOD["testfile-smoke"], result: "FAILURE" },
  });
  try {
    const { code, output } = await runVerify(server.address().port);
    assert.equal(code, 1, output);
    assert.match(output, /result FAILURE, wanted SUCCESS/);
  } finally {
    server.close();
  }
});

test("a missing JUnit report fails verification", async () => {
  const server = await stubJenkins({
    ...GOOD,
    "testfile-smoke": { ...GOOD["testfile-smoke"], report: null },
  });
  try {
    const { code, output } = await runVerify(server.address().port);
    assert.equal(code, 1, output);
    assert.match(output, /no JUnit report was recorded/);
  } finally {
    server.close();
  }
});
