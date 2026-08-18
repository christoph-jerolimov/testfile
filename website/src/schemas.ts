// The JSON schemas from the repository's schema/ folder, published on the
// website as verbatim copies - the `$id` inside each file stays the
// canonical one, and the versioning policy (spec/VERSIONING.md) allows no
// other edits here. Pulled in at build time the same way the examples are,
// so the published files can never drift from the repository.
export interface SchemaFile {
  // File name under schema/, and the last path segment of the asset URL.
  file: string;
  // The schema document, byte for byte.
  source: string;
}

// The path prefixes each schema is published under:
//
//   /v0/   - the schemas for format version 0
//   /next/ - the development head: what the next release will look like
//
// The format is at version 0 and still under review, so today the two
// channels are aliases for the same files. They diverge once version 1
// exists: /v0/ then stays frozen while /next/ moves on.
export const schemaChannels = ["v0", "next"] as const;

const files = import.meta.glob("../../schema/*.schema.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const schemaFiles: SchemaFile[] = Object.entries(files)
  .map(([path, source]) => ({ file: path.split("/").at(-1)!, source }))
  .sort((a, b) => a.file.localeCompare(b.file));
