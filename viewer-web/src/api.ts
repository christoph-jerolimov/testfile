// The REST API of `testfile-viewer serve` (see docs/cli.md).
import type { RunRecord, Summary } from "./types.js";

export async function fetchSummary(): Promise<Summary> {
  return (await fetch("/api/summary")).json();
}

export async function fetchRuns(): Promise<RunRecord[]> {
  const body = (await (await fetch("/api/runs")).json()) as { runs: RunRecord[] };
  return body.runs;
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
