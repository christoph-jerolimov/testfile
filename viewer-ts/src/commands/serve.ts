import type { Command } from "commander";
import { findViewerDir, ViewerServer } from "../serve.js";
import { color } from "../util.js";
import { commandFailed, resolveHistoryBase } from "./shared.js";

export function registerServe(program: Command): void {
program
  .command("serve")
  .argument("[path]", "directory containing a .testfile folder", ".")
  .option(
    "--port <n>",
    "port to listen on (always bound to 127.0.0.1 only)",
    (value: string) => Number.parseInt(value, 10),
    7357
  )
  .option("--name <name>", "display name shown in the web viewer")
  .description("Serve a localhost REST API and web viewer over the recorded runs")
  .action(async (path: string, options: { port: number; name?: string }) => {
    try {
      if (!(options.port >= 0 && options.port <= 65535)) {
        throw new Error("--port must be between 0 and 65535");
      }
      const base = resolveHistoryBase(path);
      const viewerDir = findViewerDir();
      const server = new ViewerServer({ baseDir: base, port: options.port, name: options.name, viewerDir });
      const port = await server.start();
      console.log(`${color(32, "●")} serving on http://127.0.0.1:${port} (Ctrl+C to stop)`);
      if (!viewerDir) {
        console.log(
          color(90, "web viewer not built — REST API only (npm run build --workspace viewer-web)")
        );
      }
      const shutdown = (): void => {
        server.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } catch (err) {
      commandFailed(err);
    }
  });
}
