// The "Get started" wizard, tested through the page a reader actually uses.
//
// Nothing here imports the generator. The answers are clicked by their
// visible labels, the file is read out of the rendered page, and every
// expectation is written here or committed under e2e/expected - a test that
// asked the generator what it produces could only prove the code equals
// itself. There is deliberately no "update the fixtures" script: a changed
// file has to be read and re-approved by hand.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const here = fileURLToPath(new URL(".", import.meta.url));
const expectedDir = join(here, "expected");
const schema = JSON.parse(
  readFileSync(join(here, "..", "..", "schema", "testfile.schema.json"), "utf8"),
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
  strictRequired: false,
});
addFormats(ajv);
const validate = ajv.compile(schema);

// The built site is handed to the browser by answering its requests from
// dist/, so the suite needs a build and no server. The origin is a fiction
// - nothing leaves the browser.
const dist = join(here, "..", "dist");
const base = "/testfile";
const START = `https://testfile.test${base}/start/`;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".txt": "text/plain",
};

// dist/ is the site as it is published; a request for a directory gets its
// index.html, exactly as a static host would serve it.
function fileFor(pathname: string): string | undefined {
  if (!pathname.startsWith(base)) return undefined;
  const relative = normalize(decodeURIComponent(pathname.slice(base.length))).replace(/^[/\\]/, "");
  if (relative.startsWith("..")) return undefined;
  const path = join(dist, relative);
  if (existsSync(path) && statSync(path).isDirectory()) {
    const index = join(path, "index.html");
    return existsSync(index) ? index : undefined;
  }
  if (existsSync(path)) return path;
  const index = join(`${path}`, "index.html");
  return existsSync(index) ? index : undefined;
}

test.beforeEach(async ({ context }) => {
  if (!existsSync(join(dist, "start", "index.html"))) {
    throw new Error(`no built site in ${dist} - run "npm run build --workspace website" first`);
  }
  await context.route("**/*", async (route) => {
    const path = fileFor(new URL(route.request().url()).pathname);
    if (!path) {
      await route.fulfill({ status: 404, body: "not built" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
      body: readFileSync(path),
    });
  });
});

// What the page is supposed to offer, written out rather than read from it:
// a language that appears without a line here is a language nobody chose to
// support, and the walk below would validate a file no one has looked at.
const INVENTORY = {
  languages: {
    "Node.js / TypeScript": ["24", "22", "20"],
    Python: ["3.13", "3.12", "3.11"],
    Go: ["1.25", "1.24", "1.23"],
    Java: ["25", "21", "17"],
    Rust: ["1.90", "1.89"],
  },
  runtimes: ["On this machine", "In a container"],
  databases: { No: [], PostgreSQL: ["18", "17", "16"], MySQL: ["9", "8.4"] },
};

// The answers behind each committed file. The labels are the reader's, not
// the code's, so this table pins the wording of the choices too.
const CASES = [
  { file: "node-local-none.yaml", answers: ["Node.js / TypeScript", "On this machine", "No"] },
  {
    file: "node-container-22-postgres-17.yaml",
    answers: ["Node.js / TypeScript", "In a container", "22", "PostgreSQL", "17"],
  },
  { file: "python-local-mysql-8.4.yaml", answers: ["Python", "On this machine", "MySQL", "8.4"] },
  { file: "go-container-1.25-none.yaml", answers: ["Go", "In a container", "1.25", "No"] },
  { file: "java-local-mysql-9.yaml", answers: ["Java", "On this machine", "MySQL", "9"] },
  {
    file: "rust-container-1.90-postgres-18.yaml",
    answers: ["Rust", "In a container", "1.90", "PostgreSQL", "18"],
  },
];

const fieldsets = (page: Page): Locator => page.locator("#wizard-form fieldset");

// The choices of one question, in the order they are offered.
async function optionsOf(fieldset: Locator): Promise<string[]> {
  return fieldset.locator("label > span:first-of-type").allTextContents();
}

// Answer the questions in order. Later questions appear and disappear as
// earlier ones are answered, so each is looked up again after the click.
async function answer(page: Page, answers: readonly string[]): Promise<void> {
  for (const [index, choice] of answers.entries()) {
    const fieldset = fieldsets(page).nth(index);
    const label = fieldset
      .locator("label")
      .filter({ has: page.getByText(choice, { exact: true }) });
    const radio = label.locator("input[type=radio]");
    if (!(await radio.isChecked())) await radio.check();
  }
}

// The file as the page shows it. The block holds one span per line, each
// ending in its newline, so the text of it is the file - read as text
// rather than as rendered lines, which is what a reader copies.
async function testfile(page: Page): Promise<string> {
  return (await page.locator("#wizard-yaml").textContent()) ?? "";
}

test.beforeEach(async ({ page }) => {
  await page.goto(START);
  await expect(page.locator("#wizard-yaml")).toContainText("version: 0");
});

test("the questions offer exactly the answers we decided to support", async ({ page }) => {
  const languages = Object.keys(INVENTORY.languages);
  expect(await optionsOf(fieldsets(page).nth(0))).toEqual(languages);
  expect(await optionsOf(fieldsets(page).nth(1))).toEqual(INVENTORY.runtimes);

  for (const [language, versions] of Object.entries(INVENTORY.languages)) {
    await answer(page, [language, "In a container"]);
    // the version question is the third one, and only exists here
    expect(await optionsOf(fieldsets(page).nth(2))).toEqual(versions);
    expect(await fieldsets(page).nth(2).locator("legend").textContent()).toContain(
      language.split(" ")[0],
    );
  }

  await answer(page, [languages[0], "On this machine"]);
  expect(await optionsOf(fieldsets(page).nth(2))).toEqual(Object.keys(INVENTORY.databases));
  for (const [database, versions] of Object.entries(INVENTORY.databases)) {
    if (versions.length === 0) continue;
    await answer(page, [languages[0], "On this machine", database]);
    expect(await optionsOf(fieldsets(page).nth(3))).toEqual(versions);
  }
});

test("a question is only asked once an earlier answer gave it a meaning", async ({ page }) => {
  const legends = async (): Promise<string[]> =>
    fieldsets(page).locator("legend").allTextContents();

  await answer(page, ["Go", "On this machine", "No"]);
  expect(await legends()).toEqual([
    "What is the project written in?",
    "Where do the tests run?",
    "Do the tests need a database?",
  ]);

  // running locally there is no image tag to pin, so no version is asked
  await answer(page, ["Go", "In a container"]);
  expect(await legends()).toEqual([
    "What is the project written in?",
    "Where do the tests run?",
    "Which Go version?",
    "Do the tests need a database?",
  ]);

  await answer(page, ["Go", "In a container", "1.24", "PostgreSQL"]);
  expect((await legends()).at(-1)).toBe("Which PostgreSQL version?");
});

test("the answers behind each committed file produce exactly that file", async ({ page }) => {
  for (const { file, answers } of CASES) {
    await answer(page, answers);
    // an answer that leaves a question unasked must not leave one behind
    await expect(fieldsets(page)).toHaveCount(answers.length);
    expect(await testfile(page), `${file} (${answers.join(", ")})`).toBe(
      readFileSync(join(expectedDir, file), "utf8"),
    );
  }
});

test("every committed file is one a case still asks for", () => {
  const committed = readdirSync(expectedDir)
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  expect(committed).toEqual(CASES.map((entry) => entry.file).sort());
});

test("every combination the page offers is a Testfile the runner accepts", async ({ page }) => {
  const seen: string[][] = [];

  // Depth-first over the questions as the page presents them: the set of
  // combinations comes from the page, so one it grows without anybody
  // saying so shows up as a count that no longer matches.
  const walk = async (prefix: string[]): Promise<void> => {
    await answer(page, prefix);
    const remaining = await fieldsets(page).count();
    if (remaining === prefix.length) {
      const text = await testfile(page);
      const doc = parse(text);
      if (!validate(doc)) {
        const problems = (validate.errors ?? [])
          .map((error) => `${error.instancePath || "/"} ${error.message}`)
          .join("; ");
        throw new Error(`${prefix.join(", ")} is not a valid Testfile: ${problems}\n\n${text}`);
      }
      seen.push(prefix);
      return;
    }
    for (const option of await optionsOf(fieldsets(page).nth(prefix.length))) {
      await walk([...prefix, option]);
    }
  };
  await walk([]);

  const perLanguage = Object.values(INVENTORY.languages).map((versions) => 1 + versions.length);
  const perDatabase = Object.values(INVENTORY.databases).reduce(
    (total, versions) => total + Math.max(1, versions.length),
    0,
  );
  const combinations = perLanguage.reduce((total, runtimes) => total + runtimes, 0) * perDatabase;
  expect(seen.length).toBe(combinations);
});

test("the lines the last answer changed are the ones marked", async ({ page }) => {
  const marked = async (): Promise<string[]> =>
    page.locator("#wizard-yaml .changed-line").allTextContents();
  const changedLabel = page.locator("#wizard-changed");

  // nothing is marked before an answer: there is no "last answer" yet
  await expect(changedLabel).toBeHidden();

  await answer(page, ["Node.js / TypeScript", "In a container"]);
  expect((await marked()).map((line) => line.trimEnd())).toEqual([
    "  # every command below runs in this image, with the project mounted",
    "  container:",
    "    image: docker.io/library/node:22",
  ]);
  await expect(changedLabel).toHaveText("3 lines from your last answer");

  // a version change moves the image line, and only that line
  await answer(page, ["Node.js / TypeScript", "In a container", "20"]);
  expect((await marked()).map((line) => line.trimEnd())).toEqual([
    "    image: docker.io/library/node:20",
  ]);
  await expect(changedLabel).toHaveText("1 line from your last answer");

  // a database is a whole block, marked as one band rather than in pieces
  await answer(page, ["Node.js / TypeScript", "In a container", "20", "PostgreSQL"]);
  const database = await marked();
  expect(database[0].trim()).toBe("");
  expect(database.map((line) => line.trimEnd())).toContain("ports:");
  expect(database.map((line) => line.trimEnd())).toContain("    - name: integration");
  await expect(changedLabel).toHaveText(`${database.length} lines from your last answer`);
});

test("the file can be copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await answer(page, ["Go", "In a container", "1.25", "No"]);
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(readFileSync(join(expectedDir, "go-container-1.25-none.yaml"), "utf8"));
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the page still shows the file the default answers make", async ({ page }) => {
    await page.goto(START);
    expect(await testfile(page)).toBe(
      readFileSync(join(expectedDir, "node-local-none.yaml"), "utf8"),
    );
    await expect(page.locator("#wizard-form fieldset")).toHaveCount(3);
  });
});
