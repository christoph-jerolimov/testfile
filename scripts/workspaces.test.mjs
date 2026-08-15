// The monorepo's own package.json files: a dependency from one workspace on
// another has to resolve to that workspace, never to the registry.
//
// npm has no `workspace:` protocol - that is a pnpm/yarn/bun feature, and npm
// refuses to install it at all (EUNSUPPORTEDPROTOCOL). What npm does instead
// is match an ordinary range against the local packages first: `@testfile/core`
// at `^0.1.0` links to testfile-ts/core, because the version there satisfies
// the range. The moment it does not - a version bumped in one place and not in
// the other - npm stops linking and goes looking on the registry, where these
// names are not published, and the install fails with
//
//     npm error 404  '@testfile/core@0.2.0' is not in this registry
//
// which reads like a network problem rather than a forgotten edit. Nothing in
// npm keeps the ranges in step (`npm version --workspaces` bumps the versions
// and leaves every dependent's range alone), so they are checked here.
import test from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { satisfies, validRange } from "semver";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));

const DEPENDENCIES = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const SCOPE = "@testfile/";

// Every workspace, by the name it publishes under.
const workspaces = new Map(
  (read("package.json").workspaces ?? [])
    .flatMap((entry) => (entry.includes("*") ? globSync(entry, { cwd: root }) : [entry]))
    .map((dir) => ({ dir, ...read(join(dir, "package.json")) }))
    .map((pkg) => [pkg.name, pkg]),
);

// [dependent, dependency name, declared range, which block it is in]
const internal = [...workspaces.values()].flatMap((pkg) =>
  DEPENDENCIES.flatMap((block) =>
    Object.entries(pkg[block] ?? [])
      .filter(([name]) => name.startsWith(SCOPE))
      .map(([name, range]) => [pkg.name, name, range, block]),
  ),
);

test("there are workspaces, and they depend on each other", () => {
  assert.ok(workspaces.size > 0, "no workspaces found - did the layout change?");
  assert.ok(internal.length > 0, `no ${SCOPE}* dependency found between them`);
});

test("every dependency between the workspaces names one of them", () => {
  for (const [from, name, , block] of internal) {
    assert.ok(
      workspaces.has(name),
      `${from} declares ${name} in ${block}, but no workspace publishes that name`,
    );
  }
});

test("every range is satisfied by the version in the workspace", () => {
  for (const [from, name, range, block] of internal) {
    // a name no workspace publishes is the test above's to report
    const version = workspaces.get(name)?.version;
    if (version === undefined) continue;
    assert.ok(validRange(range), `${from} declares ${name} as "${range}", which is not a range`);
    assert.ok(
      satisfies(version, range),
      `${from} depends on ${name} "${range}" (${block}), but ${name} is ${version} - ` +
        `npm would skip the workspace and look for ${name}@${range} on the registry`,
    );
  }
});

test("no range uses the workspace: protocol, which npm cannot install", () => {
  for (const [from, name, range] of internal) {
    assert.ok(
      !range.startsWith("workspace:"),
      `${from} depends on ${name} "${range}" - npm rejects that with EUNSUPPORTEDPROTOCOL; ` +
        `use the version range, npm resolves it against the workspace`,
    );
  }
});

// The proof that the ranges above do what they are meant to: after an install,
// the lockfile says every one of these is a link into the repository.
test("the lockfile links the workspaces instead of resolving them", () => {
  const { packages } = read("package-lock.json");
  for (const [name, pkg] of workspaces) {
    const entry = packages[`node_modules/${name}`];
    assert.ok(entry, `${name} is not in the lockfile - run npm install`);
    assert.equal(entry.link, true, `${name} is not linked in the lockfile but fetched`);
    assert.equal(entry.resolved, pkg.dir, `${name} links to ${entry.resolved}, not ${pkg.dir}`);
  }
});
