// Drives the Jenkins that container-init.sh booted: trigger each seeded
// job over the REST API, wait for its build, and assert the verdict, the
// JUnit report and the archived run. Console logs land in .tmp/consoles so
// a red leg is debuggable from the run's artifacts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = (process.env.JENKINS_URL ?? "").replace(/\/$/, "");
if (!base) {
  console.error("verify: JENKINS_URL is not set");
  process.exit(2);
}
const version = process.env.JENKINS_VERSION ?? "unknown";
const consoleDir = join(".tmp", "consoles", version.replace(/[^A-Za-z0-9._-]/g, "_"));
mkdirSync(consoleDir, { recursive: true });

// The report endpoint exposes pass/fail/skip counts (totalCount lives on
// the build action, not here), so totals are derived.
const counts = (r) => ({
  total: (r.passCount ?? 0) + (r.failCount ?? 0) + (r.skipCount ?? 0),
  failed: r.failCount ?? 0,
});

const EXPECTATIONS = [
  {
    job: "testfile-smoke",
    result: "SUCCESS",
    report: (r) => counts(r).total === 2 && counts(r).failed === 0,
    reportWanted: "2 tests, 0 failures",
    archivedRun: true,
  },
  {
    job: "testfile-filtered",
    result: "SUCCESS",
    report: (r) => counts(r).total === 1 && counts(r).failed === 0,
    reportWanted: "1 test (the fast one), 0 failures",
  },
  {
    job: "testfile-failing",
    result: "FAILURE",
    report: (r) => counts(r).failed >= 1,
    reportWanted: "at least 1 failure recorded",
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Jenkins wants a CSRF crumb on every POST, tied to the session cookie the
// crumb request opened. A 404 means the issuer is off - then no crumb.
async function crumbHeaders() {
  const res = await fetch(`${base}/crumbIssuer/api/json`);
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`crumb request failed: HTTP ${res.status}`);
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const data = await res.json();
  const headers = { [data.crumbRequestField]: data.crumb };
  if (cookies) headers.cookie = cookies;
  return headers;
}

// The jobs are seeded during startup; give a just-ready Jenkins a moment
// before deciding a 404 means the seeding failed.
async function trigger(job) {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const res = await fetch(`${base}/job/${job}/build?delay=0sec`, {
      method: "POST",
      headers: await crumbHeaders(),
    });
    if (res.status === 201) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`${job}: build accepted but no queue location`);
      return location.endsWith("/") ? location : `${location}/`;
    }
    if (res.status !== 404 || Date.now() > deadline) {
      throw new Error(`${job}: triggering failed: HTTP ${res.status}`);
    }
    await sleep(3000);
  }
}

async function json(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.json();
}

async function waitForBuildUrl(job, queueUrl) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const item = await json(`${queueUrl}api/json`);
    if (item?.cancelled) throw new Error(`${job}: queue item was cancelled`);
    if (item?.executable?.url) return item.executable.url;
    await sleep(2000);
  }
  throw new Error(`${job}: build did not leave the queue in time`);
}

async function waitForResult(job, buildUrl) {
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const build = await json(`${buildUrl}api/json`);
    if (build && build.building === false && build.result) return build;
    await sleep(3000);
  }
  throw new Error(`${job}: build did not finish in time`);
}

async function saveConsole(job, buildUrl) {
  try {
    const res = await fetch(`${buildUrl}consoleText`);
    const text = await res.text();
    writeFileSync(join(consoleDir, `${job}.log`), text);
    return text;
  } catch {
    return "";
  }
}

const failures = [];
for (const expected of EXPECTATIONS) {
  const { job } = expected;
  try {
    console.log(`[${version}] ${job}: triggering`);
    const queueUrl = await trigger(job);
    const buildUrl = await waitForBuildUrl(job, queueUrl);
    const build = await waitForResult(job, buildUrl);
    const consoleText = await saveConsole(job, buildUrl);

    const problems = [];
    if (build.result !== expected.result) {
      problems.push(`result ${build.result}, wanted ${expected.result}`);
    }
    const report = await json(`${buildUrl}testReport/api/json`);
    if (!report) {
      problems.push("no JUnit report was recorded");
    } else if (!expected.report(report)) {
      problems.push(
        `JUnit report has ${counts(report).total} tests / ${counts(report).failed} failures, wanted ${expected.reportWanted}`,
      );
    }
    if (expected.archivedRun) {
      const artifacts = build.artifacts ?? [];
      if (!artifacts.some((a) => a.relativePath?.startsWith(".testfile/runs/"))) {
        problems.push("no archived .testfile/runs artifact");
      }
    }

    if (problems.length > 0) {
      failures.push(`${job}: ${problems.join("; ")}`);
      const tail = consoleText.split("\n").slice(-60).join("\n");
      console.error(
        `[${version}] ${job}: FAILED - ${problems.join("; ")}\n--- console tail ---\n${tail}\n---`,
      );
    } else {
      console.log(
        `[${version}] ${job}: ok (${build.result}, ${counts(report).total} tests, ${counts(report).failed} failures)`,
      );
    }
  } catch (error) {
    failures.push(`${job}: ${error.message}`);
    console.error(`[${version}] ${job}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(
    `[${version}] ${failures.length} of ${EXPECTATIONS.length} jobs failed verification`,
  );
  process.exit(1);
}
console.log(`[${version}] all ${EXPECTATIONS.length} jobs verified`);
