// The examples pages render the real Testfiles from the repository's
// examples/ folder (validated against the schema in CI), so a page can never
// drift from the file it shows. The files are pulled in at build time and
// resolved against *this* module - reading them from disk at render time
// would depend on where the compiled page ends up.
import { parse } from "yaml";

export interface ExampleMeta {
  // Position in the menu; the gallery had no other order either.
  order: number;
  title: string;
  stack: string;
  summary: string;
  highlights: string[];
}

export interface Example {
  // Directory name under examples/, and the route under /examples/.
  id: string;
  meta: ExampleMeta;
  // The Testfile as published: the editor's schema hint is an instruction to
  // the language server, not part of the example.
  testfile: string;
}

const metaFiles = import.meta.glob("../../examples/*/example.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const testfiles = import.meta.glob("../../examples/*/Testfile", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// ".../examples/pytest-postgres/example.yaml" -> "pytest-postgres"
const idOf = (path: string): string => path.split("/").at(-2)!;

export const examples: Example[] = Object.entries(metaFiles)
  .map(([path, source]) => {
    const id = idOf(path);
    const testfile = Object.entries(testfiles).find(([file]) => idOf(file) === id)?.[1];
    if (testfile === undefined) throw new Error(`examples/${id} has no Testfile`);
    return {
      id,
      meta: parse(source) as ExampleMeta,
      testfile: testfile.replace(/^# yaml-language-server:.*\n/, ""),
    };
  })
  .sort((a, b) => a.meta.order - b.meta.order);

// Where the menu and the header link point: there is no examples index, the
// same way there is no documentation index.
export const firstExample = examples[0];

export const examplesRepoUrl = "https://github.com/testfile-dev/testfile/blob/main/examples";
