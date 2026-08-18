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
// the site is served at the domain root, so pages sit directly under /
const base = "";
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
const ALL = "All of them";
const INVENTORY: {
  languages: Record<string, string[]>;
  runtimes: string[];
  databases: string[];
} = {
  languages: {
    "Node.js": ["20", "22", "24"],
    Python: ["3.11", "3.12", "3.13"],
    Go: ["1.23", "1.24", "1.25"],
    Java: ["17", "21", "25"],
    Rust: ["1.89", "1.90"],
  },
  runtimes: ["On this machine", "In a container"],
  // one database, and its versions, in one question
  databases: ["No database", "16", "17", "18", ALL],
};

// The answers behind each committed file. The labels are the reader's, not
// the code's, so this table pins the wording of the choices too.
const CASES = [
  {
    file: "node-22-local-no-database.yaml",
    answers: ["Node.js", "22", "On this machine", "No database"],
  },
  {
    file: "node-22-container-postgres-17.yaml",
    answers: ["Node.js", "22", "In a container", "17"],
  },
  // "All of them" skips the next question: only a container can give one
  // machine three toolchains, so there is nothing left to ask.
  { file: "go-all-versions-no-database.yaml", answers: ["Go", ALL, "No database"] },
  {
    file: "python-3.12-local-postgres-all-versions.yaml",
    answers: ["Python", "3.12", "On this machine", ALL],
  },
  { file: "java-21-container-postgres-16.yaml", answers: ["Java", "21", "In a container", "16"] },
  { file: "node-all-versions-postgres-17.yaml", answers: ["Node.js", ALL, "17"] },
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
  await expect(fieldsets(page)).toHaveCount(1);
});

test("the page opens on one unanswered question and no file", async ({ page }) => {
  await expect(fieldsets(page).locator("legend")).toHaveText(["What is the project written in?"]);
  await expect(page.locator("#wizard-form input:checked")).toHaveCount(0);
  expect(await testfile(page)).toBe("");
  await expect(page.locator("#wizard-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy" })).toBeHidden();
});

test("each answer earns the next question, and nothing is chosen in advance", async ({ page }) => {
  const legends = async (): Promise<string[]> =>
    fieldsets(page).locator("legend").allTextContents();
  // an unanswered question is the last one on the page, with nothing picked
  const open = async (): Promise<void> => {
    await expect(page.locator("#wizard-form input:checked")).toHaveCount(
      (await fieldsets(page).count()) - 1,
    );
  };

  await open();
  await answer(page, ["Go"]);
  expect(await legends()).toEqual(["What is the project written in?", "Which Go version?"]);
  await open();

  await answer(page, ["Go", "1.24"]);
  expect((await legends()).at(-1)).toBe("Where do the tests run?");
  await open();

  await answer(page, ["Go", "1.24", "On this machine"]);
  expect((await legends()).at(-1)).toBe("Use a database like PostgreSQL");
  await open();

  // ... and answering the last one leaves nothing open
  await answer(page, ["Go", "1.24", "On this machine", "17"]);
  await expect(page.locator("#wizard-form input:checked")).toHaveCount(4);
});

test("a suite already running per version is not asked to fan out twice", async ({ page }) => {
  // Every database version too would mean copies of the same container at
  // the same time, on the one port a run allocates - so that answer is not
  // offered here, and nothing the page can build needs `shared`.
  await answer(page, ["Go", ALL]);
  expect(await optionsOf(fieldsets(page).nth(2))).toEqual(
    INVENTORY.databases.filter((option) => option !== ALL),
  );
  await answer(page, ["Go", ALL, "17"]);
  expect(await testfile(page)).not.toContain("shared:");
});

test("wanting every version settles where the tests run: only a container can", async ({
  page,
}) => {
  await answer(page, ["Go", ALL]);
  expect(await fieldsets(page).locator("legend").allTextContents()).toEqual([
    "What is the project written in?",
    "Which Go version?",
    "Use a database like PostgreSQL",
  ]);
  expect(await testfile(page)).toContain("image: docker.io/library/golang:${{ matrix.go }}");
});

test("the questions offer exactly the answers we decided to support", async ({ page }) => {
  const languages = Object.keys(INVENTORY.languages);
  expect(await optionsOf(fieldsets(page).nth(0))).toEqual(languages);

  for (const [language, versions] of Object.entries(INVENTORY.languages)) {
    await answer(page, [language]);
    expect(await optionsOf(fieldsets(page).nth(1))).toEqual([...versions, ALL]);
    expect(await fieldsets(page).nth(1).locator("legend").textContent()).toContain(
      language.split(" ")[0],
    );
  }

  const first = [languages[0], INVENTORY.languages[languages[0]][0]];
  await answer(page, first);
  expect(await optionsOf(fieldsets(page).nth(2))).toEqual(INVENTORY.runtimes);

  await answer(page, [...first, "On this machine"]);
  expect(await optionsOf(fieldsets(page).nth(3))).toEqual(INVENTORY.databases);
  // the last question, whichever way it is answered
  await answer(page, [...first, "On this machine", ALL]);
  await expect(fieldsets(page)).toHaveCount(4);
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
  // Hundreds of them, answered by clicking: far longer than a test that
  // looks at one page, and worth the wall clock.
  test.setTimeout(300_000);
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

  // Per language: each version can be run locally or in a container, and
  // "all of them" is one more answer that settles that question itself.
  const perLanguage = Object.values(INVENTORY.languages).reduce(
    (total, versions) => total + versions.length * INVENTORY.runtimes.length + 1,
    0,
  );
  // ... except that "all of them" for the language takes the same answer
  // off the database question, so those branches are one narrower.
  const everyLanguageVersion = Object.keys(INVENTORY.languages).length;
  expect(seen.length).toBe(perLanguage * INVENTORY.databases.length - everyLanguageVersion);
});

test("the lines the last answer changed are the ones marked", async ({ page }) => {
  const marked = async (): Promise<string[]> =>
    page.locator("#wizard-yaml .changed-line").allTextContents();
  const changedLabel = page.locator("#wizard-changed");

  // nothing is marked before an answer: there is no "last answer" yet
  await expect(changedLabel).toBeHidden();

  // the version is what the project targets, and says so until the next
  // answer decides whether to pin it
  await answer(page, ["Node.js", "20"]);
  expect((await marked()).map((line) => line.trimEnd())).toEqual([
    "  # the project targets Node.js 20; this runs with whatever is installed",
  ]);
  await expect(changedLabel).toHaveText("1 line from your last answer");

  await answer(page, ["Node.js", "20", "In a container"]);
  expect((await marked()).map((line) => line.trimEnd())).toEqual([
    "  # every command below runs in this image, with the project mounted",
    "  container:",
    "    image: docker.io/library/node:20",
  ]);
  await expect(changedLabel).toHaveText("3 lines from your last answer");

  // a database is a whole block, marked as one band rather than in pieces
  await answer(page, ["Node.js", "20", "In a container", "17"]);
  const database = await marked();
  expect(database[0].trim()).toBe("");
  const text = database.map((line) => line.trimEnd());
  expect(text).toContain("ports:");
  expect(text).toContain("    - name: integration");
  // the service is the test's own, not the run's
  expect(text).toContain("      services:");
  expect(text).toContain("            image: docker.io/library/postgres:17-alpine");
  await expect(changedLabel).toHaveText(`${database.length} lines from your last answer`);
});

test("the file can be copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await answer(page, ["Go", ALL, "No database"]);
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(readFileSync(join(expectedDir, "go-all-versions-no-database.yaml"), "utf8"));
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the page still asks the first question", async ({ page }) => {
    await page.goto(START);
    await expect(page.locator("#wizard-form fieldset")).toHaveCount(1);
    await expect(page.locator("#wizard-empty")).toBeVisible();
    expect(await testfile(page)).toBe("");
  });
});
