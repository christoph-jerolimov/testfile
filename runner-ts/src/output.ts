import { EventEmitter } from "node:events";

export type Stream = "stdout" | "stderr" | "system";

export interface OutputLine {
  text: string;
  stream: Stream;
}

// Collects the output of one test or service as lines, for the TUI, the
// console reporter and log-based readiness checks.
export class OutputBuffer extends EventEmitter {
  readonly lines: OutputLine[] = [];
  private partial: Partial<Record<Stream, string>> = {};

  constructor(private readonly maxLines = 5000) {
    super();
  }

  append(chunk: string | Buffer, stream: Stream): void {
    const text = (this.partial[stream] ?? "") + chunk.toString();
    const parts = text.split(/\r?\n/);
    this.partial[stream] = parts.pop() ?? "";
    for (const line of parts) this.push({ text: line, stream });
  }

  system(text: string): void {
    this.push({ text, stream: "system" });
  }

  flush(): void {
    for (const stream of ["stdout", "stderr"] as const) {
      const rest = this.partial[stream];
      if (rest) {
        this.partial[stream] = "";
        this.push({ text: rest, stream });
      }
    }
  }

  // Combined text of stdout+stderr (or a single stream), for log matching.
  text(stream?: "stdout" | "stderr"): string {
    return this.lines
      .filter((l) => (stream ? l.stream === stream : l.stream !== "system"))
      .map((l) => l.text)
      .join("\n");
  }

  private push(line: OutputLine): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
    this.emit("line", line);
  }
}
