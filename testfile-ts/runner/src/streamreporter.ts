import type { Runner } from "./executor.js";
import type { OutputLine } from "./output.js";
import { walk, type RunTest, type Status } from "./runsuite.js";
import type { ServiceInstance } from "./services.js";

// The machine twin of ConsoleReporter: one JSON object per line on stdout
// (NDJSON), so a tool or agent supervising the run can react to the first
// failure instead of parsing a human summary after the fact.
//
// The stream is a contract:
//   run-start   selected, at
//   test-start  path, kind
//   line        path|service, stream, text     (test output; services with -v)
//   test-end    path, status, durationMs?, cached?, reason?, error?
//   service     name, status, error?           (every status change)
//   run-end     status, exitCode, runId?, counts, at
//
// Fields that do not apply are omitted rather than null, and unknown events
// or fields must be ignored by consumers - additions stay compatible.
export class StreamReporter {
  constructor(
    private readonly runner: Runner,
    private readonly options: { verbose: boolean; selected: number },
    private readonly write: (line: string) => void = (line) => process.stdout.write(line),
  ) {
    this.emit({
      event: "run-start",
      selected: options.selected,
      at: new Date().toISOString(),
    });
    runner.on("test-start", (test: RunTest) => {
      this.emit({ event: "test-start", path: test.path, kind: test.kind });
      if (test.children.length === 0) {
        test.output.on("line", (line: OutputLine) => {
          if (line.stream === "system" && !this.options.verbose) return;
          this.emit({ event: "line", path: test.path, stream: line.stream, text: line.text });
        });
      }
    });
    runner.on("test-end", (test: RunTest) => {
      const timed = test.startedAt !== undefined && test.endedAt !== undefined;
      this.emit({
        event: "test-end",
        path: test.path,
        status: test.status,
        ...(timed ? { durationMs: test.endedAt! - test.startedAt! } : {}),
        ...(test.cached ? { cached: true } : {}),
        ...(test.reason ? { reason: test.reason } : {}),
        ...(test.error && test.status !== "passed" ? { error: test.error } : {}),
      });
    });
    runner.on("service-added", (service: ServiceInstance) => {
      let last: string | undefined;
      const report = (): void => {
        if (service.status === last) return;
        last = service.status;
        this.emit({
          event: "service",
          name: service.name,
          status: service.status,
          ...(service.error ? { error: service.error } : {}),
        });
      };
      report();
      service.on("update", report);
      if (this.options.verbose) {
        service.output.on("line", (line: OutputLine) =>
          this.emit({
            event: "line",
            service: service.name,
            stream: line.stream,
            text: line.text,
          }),
        );
      }
    });
  }

  // The last line of a run's stream; counts cover the leaf tests only, the
  // same tests the human summary counts.
  runEnd(result: { status: Status; exitCode: number; runId?: string }): void {
    const counts: Partial<Record<Status, number>> = {};
    walk(this.runner.root, (test) => {
      if (test.children.length === 0) counts[test.status] = (counts[test.status] ?? 0) + 1;
    });
    this.emit({
      event: "run-end",
      status: result.status,
      exitCode: result.exitCode,
      ...(result.runId ? { runId: result.runId } : {}),
      counts,
      at: new Date().toISOString(),
    });
  }

  private emit(event: Record<string, unknown>): void {
    this.write(`${JSON.stringify(event)}\n`);
  }
}
