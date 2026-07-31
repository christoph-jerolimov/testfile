import type { Runner } from "./executor.js";
import type { OutputLine } from "./output.js";
import type { RunNode, Status } from "./runtree.js";
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
    runner.on("node-start", (node: RunNode) => {
      this.print(`${glyph("running")} ${this.label(node)}`);
      if (node.children.length === 0) {
        node.output.on("line", (line: OutputLine) => this.printLine(node.name, line, false));
      }
    });
    runner.on("node-end", (node: RunNode) => {
      const duration = node.startedAt && node.endedAt ? ` (${formatMs(node.endedAt - node.startedAt)})` : "";
      const error = node.error && node.status !== "passed" ? ` — ${node.error}` : "";
      this.print(`${glyph(node.status)} ${this.label(node)}${duration}${error}`);
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

  private label(node: RunNode): string {
    return `${"  ".repeat(node.depth)}${node.name}`;
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
    const visit = (node: RunNode) => {
      counts[node.status] = (counts[node.status] ?? 0) + 1;
      const duration = node.startedAt && node.endedAt ? ` (${formatMs(node.endedAt - node.startedAt)})` : "";
      lines.push(`${"  ".repeat(node.depth)}${glyph(node.status)} ${node.name}${duration}`);
      node.children.forEach(visit);
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
