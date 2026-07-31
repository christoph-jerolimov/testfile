import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

export function allocateRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

export async function resolvePorts(
  def: Record<string, number | "random"> | undefined
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(def ?? {})) {
    out[name] = value === "random" ? await allocateRandomPort() : value;
  }
  return out;
}
