// The three normative documents in spec/ are published on the website as
// verbatim copies: the collection in content.config.ts reads the markdown
// files, this list gives them their route, menu label and page title (the
// files themselves carry no frontmatter).
export interface SpecPage {
  // Entry id in the "spec" collection - the file name without extension.
  id: string;
  // Route under /spec/.
  slug: string;
  // Label in the documentation menu.
  label: string;
  title: string;
  description: string;
  // Path in the repository, shown as the source of the copy.
  source: string;
}

export const specPages: SpecPage[] = [
  {
    id: "TESTFILE",
    slug: "testfile",
    label: "Testfile (yaml)",
    title: "Testfile specification (v0)",
    description:
      "The normative specification of the Testfile format: how a project describes its tests.",
    source: "spec/TESTFILE.md",
  },
  {
    id: "RESULTS",
    slug: "test-result",
    label: "Test result (run.yaml)",
    title: "Test result format (v0)",
    description:
      "The normative specification of a recorded test run: the run folder, run.yaml and the logs next to it.",
    source: "spec/RESULTS.md",
  },
  {
    id: "VERSIONING",
    slug: "versioning",
    label: "Versioning policy",
    title: "Versioning and compatibility policy",
    description: "How the Testfile format evolves and what runners and users can rely on.",
    source: "spec/VERSIONING.md",
  },
];

export const repoBlobUrl = "https://github.com/christoph-jerolimov/testfile/blob/main";
