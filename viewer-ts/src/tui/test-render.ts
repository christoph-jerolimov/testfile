// A minimal render harness for TUI tests: Ink rendering into fake streams,
// 100 columns by 30 rows, with a writable stdin to drive keys. The same
// approach as ink-testing-library, inlined so it always resolves the same
// ink copy the app uses.
import { EventEmitter } from "node:events";
import { render as inkRender } from "ink";
import type React from "react";

// Tests assert on text; under the runner color is forced on (FORCE_COLOR),
// so the frames carry SGR codes that would break every plain-text match.
function stripStyles(frame: string): string {
  // eslint-disable-next-line no-control-regex
  return frame.replace(/\u001b\[[0-9;]*m/g, "");
}

class FakeStdout extends EventEmitter {
  readonly columns = 100;
  readonly rows = 30;
  readonly frames: string[] = [];
  private last: string | undefined;
  write = (frame: string): boolean => {
    this.frames.push(frame);
    this.last = frame;
    return true;
  };
  lastFrame = (): string | undefined =>
    this.last === undefined ? undefined : stripStyles(this.last);
}

class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  private data: string | null = null;
  write = (data: string): void => {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  };
  read = (): string | null => {
    const data = this.data;
    this.data = null;
    return data;
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

export interface TestRender {
  stdin: FakeStdin;
  frames: string[];
  lastFrame(): string | undefined;
  unmount(): void;
}

export function renderForTest(tree: React.ReactElement): TestRender {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout() as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return {
    stdin,
    frames: stdout.frames,
    lastFrame: stdout.lastFrame,
    unmount: () => instance.unmount(),
  };
}
