import type { Runner } from "./executor.js";
import type { OutputLine } from "./output.js";
import type { RunTest, Status } from "./runsuite.js";
import type { ServiceInstance } from "./services.js";
import { color, formatMs } from "./util.js";

const STATUS_GLYPH: Record<Status, string> = {
  pending: "·",
  running: "▶",
  passed: "✔",
  failed: "✘",
  skipped: "↷",
  aborted: "■",
};

const STATUS_COLOR: Record<Status, number> = {
  pending: 90,
  running: 33,
  passed: 32,
  failed: 31,
  skipped: 90,
  aborted: 35,
};

function glyph(status: Status): string {
  return color(STATUS_COLOR[status], STATUS_GLYPH[status]);
}

// Plain streaming reporter for non-TUI runs.
export class ConsoleReporter {
  constructor(
    private readonly runner: Runner,
    private readonly options: { verbose: boolean } = { verbose: false }
  ) {
    runner.on("test-start", (test: RunTest) => {
      this.print(`${glyph("running")} ${this.label(test)}`);
      if (test.children.length === 0) {
        test.output.on("line", (line: OutputLine) => this.printLine(test.name, line, false));
      }
    });
    runner.on("test-end", (test: RunTest) => {
      const duration = test.startedAt && test.endedAt ? ` (${formatMs(test.endedAt - test.startedAt)})` : "";
      const error = test.error && test.status !== "passed" ? ` — ${test.error}` : "";
      this.print(`${glyph(test.status)} ${this.label(test)}${duration}${error}`);
    });
    runner.on("service-added", (service: ServiceInstance) => {
      this.print(`${color(36, "◆")} service ${service.name} starting`);
      service.on("update", () => {
        if (service.status === "ready") this.print(`${color(36, "◆")} service ${service.name} ready`);
        if (service.status === "failed") {
          this.print(`${glyph("failed")} service ${service.name} failed${service.error ? `: ${service.error}` : ""}`);
          this.dumpTail(service);
        }
      });
      if (this.options.verbose) {
        service.output.on("line", (line: OutputLine) => this.printLine(`svc:${service.name}`, line, true));
      }
    });
  }

  private label(test: RunTest): string {
    return `${"  ".repeat(test.depth)}${test.name}`;
  }

  private printLine(name: string, line: OutputLine, dim: boolean): void {
    if (line.stream === "system" && !this.options.verbose) return;
    const prefix = color(dim ? 90 : 36, `[${name}]`);
    const text = line.stream === "stderr" ? color(33, line.text) : line.text;
    this.print(`${prefix} ${text}`);
  }

  private dumpTail(service: ServiceInstance): void {
    const tail = service.output.lines.slice(-30);
    for (const line of tail) this.printLine(`svc:${service.name}`, line, true);
  }

  private print(text: string): void {
    process.stdout.write(`${text}\n`);
  }

  summary(): void {
    const counts: Partial<Record<Status, number>> = {};
    const lines: string[] = [];
    const visit = (test: RunTest) => {
      counts[test.status] = (counts[test.status] ?? 0) + 1;
      const duration = test.startedAt && test.endedAt ? ` (${formatMs(test.endedAt - test.startedAt)})` : "";
      lines.push(`${"  ".repeat(test.depth)}${glyph(test.status)} ${test.name}${duration}`);
      test.children.forEach(visit);
    };
    visit(this.runner.root);
    this.print("");
    for (const line of lines) this.print(line);
    const parts = (Object.entries(counts) as [Status, number][])
      .filter(([, n]) => n > 0)
      .map(([status, n]) => `${n} ${status}`);
    this.print("");
    this.print(parts.join(", "));
  }
}
