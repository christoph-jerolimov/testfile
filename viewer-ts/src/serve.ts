// `testfile serve`: a read-only REST API over the recorded runs plus the
// web viewer (the React app in the viewer-web/ workspace), served on
// localhost ONLY - the listener binds to 127.0.0.1 and never exposes the
// history to the network.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { recordedTests, RunHistory, type RunRecord, watchRuns } from "@testfile/core";

export interface ServeOptions {
  baseDir: string;
  port: number;
  // Human-readable name (from the Testfile), when available.
  name?: string;
  // Directory of the built web viewer; auto-detected when omitted.
  viewerDir?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// What a run keeps: the types worth naming, so the browser shows them
// instead of downloading them. Everything else is served as a download.
const FILE_TYPES: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

// A recorded path, turned into something safe to join onto the run folder.
// Every segment is decoded first, because "%2e%2e" is "..". Returns
// undefined for anything that could leave the folder.
export function safeRelative(segments: readonly string[]): string | undefined {
  if (segments.length === 0) return undefined;
  const parts: string[] = [];
  for (const raw of segments) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (segment === "" || segment === "." || segment === "..") return undefined;
    if (segment.includes("\\") || segment.includes("\0") || segment.includes("/")) return undefined;
    parts.push(segment);
  }
  return parts.join("/");
}

// The built viewer app: next to this package in the monorepo, or wherever
// TESTFILE_VIEWER points.
export function findViewerDir(): string | undefined {
  const candidates = [
    process.env.TESTFILE_VIEWER,
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "viewer-web", "dist"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "index.html"))) return resolve(candidate);
  }
  return undefined;
}

export class ViewerServer {
  readonly server: Server;
  private readonly history: RunHistory;
  private readonly clients = new Set<ServerResponse>();
  private stopWatching?: () => void;

  constructor(private readonly options: ServeOptions) {
    this.history = new RunHistory(options.baseDir);
    this.server = createServer((request, response) => this.handle(request, response));
  }

  // Resolves with the actual port once listening (options.port may be 0).
  start(): Promise<number> {
    this.stopWatching = watchRuns(this.options.baseDir, () => {
      this.history.reload();
      for (const client of this.clients) client.write(`data: runs-changed\n\n`);
    });
    return new Promise((resolvePort, reject) => {
      this.server.once("error", reject);
      // localhost only - never expose the run history to the network
      this.server.listen(this.options.port, "127.0.0.1", () => {
        const address = this.server.address();
        resolvePort(typeof address === "object" && address ? address.port : this.options.port);
      });
    });
  }

  close(): void {
    this.stopWatching?.();
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.server.close();
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) this.handleApi(url, response);
      else this.handleStatic(url.pathname, response);
    } catch (err) {
      this.json(response, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private handleApi(url: URL, response: ServerResponse): void {
    const [, , resource, id, sub, ...rest] = url.pathname.split("/");
    if (resource === "summary") {
      return this.json(response, 200, {
        name: this.options.name,
        baseDir: this.options.baseDir,
        runs: this.history.runs.length,
      });
    }
    if (resource === "runs" && !id) {
      return this.json(response, 200, { runs: this.history.runs });
    }
    if (resource === "runs" && id) {
      // ids are timestamps + hex; anything else could be path traversal
      if (!/^[A-Za-z0-9-]+$/.test(id)) return this.json(response, 400, { error: "invalid run id" });
      const run = this.history.find(id);
      if (!run) return this.json(response, 404, { error: `no run ${id}` });
      if (!sub) return this.json(response, 200, run);
      if (sub === "log") {
        const testPath = url.searchParams.get("test");
        const serviceName = url.searchParams.get("service");
        const text =
          testPath !== null
            ? (() => {
                const test = run.tests.find((t) => t.path === testPath);
                return test ? this.history.readLog(run, test) : undefined;
              })()
            : serviceName !== null
              ? (() => {
                  const service = run.services?.find((s) => s.name === serviceName);
                  return service ? this.history.readServiceLog(run, service) : undefined;
                })()
              : this.history.readRunLog(run);
        if (text === undefined) return this.json(response, 404, { error: "no log recorded" });
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        return void response.end(text);
      }
      // Anything the run kept, addressed exactly as run.yaml records it:
      // "artifacts/ci-unit/report.txt", "junit.xml", "run.yaml".
      if (sub === "artifacts") return this.sendFile(run, rest, response);
    }
    if (resource === "results") {
      return this.json(response, 200, { tests: recordedTests(this.history) });
    }
    if (resource === "events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(`data: connected\n\n`);
      this.clients.add(response);
      response.on("close", () => this.clients.delete(response));
      return;
    }
    this.json(response, 404, { error: "not found" });
  }

  // Reading a file out of a run folder, and out of that folder only: the
  // segments are checked one by one, and the resolved path has to still be
  // inside the folder afterwards. Nothing is ever served as HTML or
  // JavaScript - a recorded artifact must not be able to run as a page on
  // the viewer's own origin.
  private sendFile(run: RunRecord, segments: string[], response: ServerResponse): void {
    const relative = safeRelative(segments);
    if (relative === undefined) return this.json(response, 400, { error: "invalid path" });
    const runDir = this.history.runDir(run);
    const file = resolve(runDir, relative);
    if (!file.startsWith(`${resolve(runDir)}${sep}`)) {
      return this.json(response, 400, { error: "invalid path" });
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      return this.json(response, 404, { error: `no file ${relative}` });
    }
    response.writeHead(200, {
      "content-type": FILE_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-disposition": `inline; filename="${basename(file).replace(/["\\]/g, "")}"`,
      "x-content-type-options": "nosniff",
    });
    response.end(readFileSync(file));
  }

  private handleStatic(pathname: string, response: ServerResponse): void {
    const viewerDir = this.options.viewerDir;
    if (!viewerDir) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void response.end(
        '<!doctype html><h1>testfile serve</h1><p>The web viewer is not built; the REST API is available under <a href="/api/runs">/api/runs</a>.</p>',
      );
    }
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = resolve(viewerDir, relative);
    // stay inside the viewer directory
    if (!file.startsWith(viewerDir) || !existsSync(file) || !statSync(file).isFile()) {
      // single-page app: unknown paths fall back to the index
      response.writeHead(200, { "content-type": CONTENT_TYPES[".html"] });
      return void response.end(readFileSync(join(viewerDir, "index.html")));
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    });
    response.end(readFileSync(file));
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }
}
