// The REST API of `testfile serve` (see docs/cli.md), as TanStack Query
// options: a component asks for `runsQuery` and gets the cached copy, and
// one invalidation after a server ping refetches whatever is on screen.
import { queryOptions } from "@tanstack/react-query";
import type { RunRecord, Summary } from "./types.js";

// Everything the server can tell us hangs off this, so a single
// `invalidateQueries({ queryKey: api })` covers a run that changed.
export const api = ["api"] as const;

export const summaryQuery = queryOptions({
  queryKey: [...api, "summary"],
  queryFn: async (): Promise<Summary> => (await fetch("/api/summary")).json(),
});

export const runsQuery = queryOptions({
  queryKey: [...api, "runs"],
  queryFn: async (): Promise<RunRecord[]> => {
    const body = (await (await fetch("/api/runs")).json()) as { runs: RunRecord[] };
    return body.runs;
  },
});

// A log is read as text, and says so in place of throwing: a run still being
// written has tests whose log is not there yet, and that is not an error.
export function logQuery(url: string) {
  return queryOptions({
    queryKey: [...api, "log", url],
    queryFn: async (): Promise<string> => {
      const response = await fetch(url);
      return response.ok ? response.text() : `(no log: ${response.status})`;
    },
  });
}

export function runLogUrl(runId: string): string {
  return `/api/runs/${runId}/log`;
}

export function testLogUrl(runId: string, testPath: string): string {
  return `/api/runs/${runId}/log?test=${encodeURIComponent(testPath)}`;
}

export function serviceLogUrl(runId: string, serviceName: string): string {
  return `/api/runs/${runId}/log?service=${encodeURIComponent(serviceName)}`;
}

// Anything the run kept, addressed exactly as run.yaml records it:
// "artifacts/ci-unit/report.txt", "junit.xml", "run.yaml". Each segment is
// encoded on its own, so the slashes survive and the names are escaped.
export function fileUrl(runId: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `/api/runs/${runId}/artifacts/${encoded}`;
}

// The last segment - what an artifact is called, without where it sits.
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

// Server-sent events: the server pings whenever .testfile/runs/ changes.
export function subscribeRunsChanged(
  onChange: () => void,
  onState: (live: boolean) => void,
): () => void {
  const events = new EventSource("/api/events");
  events.onopen = () => onState(true);
  events.onerror = () => onState(false);
  events.onmessage = (message) => {
    if (message.data === "runs-changed") onChange();
  };
  return () => events.close();
}
