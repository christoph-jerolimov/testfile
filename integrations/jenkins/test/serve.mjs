// Serves the integration folder (the shared library plus this test rig) as
// a tarball, so the Jenkins containers can fetch what they cannot mount: a
// Testfile has no way to name an absolute host path for a volume, but a
// container with host networking can reach this server on localhost.
//
// GET /src.tgz  -> tar of the folder (fresh per request, edits included)
// GET /healthz  -> 200, the Testfile's readiness check
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 0);

const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (path !== "/src.tgz") {
    res.writeHead(404).end("not found");
    return;
  }
  // What a checkout would contain: no recorded runs, no scratch files.
  const tar = spawn(
    "tar",
    [
      "-cz",
      "--exclude",
      ".testfile",
      "--exclude",
      ".tmp",
      "--exclude",
      "node_modules",
      "-C",
      root,
      ".",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  res.writeHead(200, { "content-type": "application/gzip" });
  tar.stdout.pipe(res);
  tar.on("error", () => res.destroy());
  tar.on("exit", (code) => {
    if (code !== 0) res.destroy();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}/src.tgz`);
});
