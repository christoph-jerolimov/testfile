import { spawnSync } from "node:child_process";
import { hostname } from "node:os";

// Who ran a suite, recorded in run.yaml so a shared history says where a
// result came from. Preference: the GitHub account (the same identity that
// shows up on a PR), then CI-provided actor names, then the machine's
// hostname. Never fails - the field is optional.

let cached: string | undefined | null = null;

function ghUser(): string | undefined {
  const result = spawnSync("gh", ["api", "user", "--jq", ".login"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.status !== 0) return undefined;
  const login = (result.stdout ?? "").trim();
  return login && !login.includes("\n") ? login : undefined;
}

export function detectMachine(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (cached !== null) return cached;
  cached = detect(env);
  return cached;
}

// Exported for tests: no caching, explicit environment.
export function detect(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // On CI the actor is authoritative and cheap; asking gh there would only
  // report the token's bot identity.
  const actor = env.GITHUB_ACTOR ?? env.GITLAB_USER_LOGIN ?? env.BUILDKITE_BUILD_CREATOR;
  if (actor) return actor;
  try {
    const login = ghUser();
    if (login) return login;
  } catch {
    // gh is not installed, not authenticated or too slow
  }
  const host = hostname();
  return host && host !== "localhost" ? host : undefined;
}

// Test seam: forget a detected value.
export function resetMachineCache(): void {
  cached = null;
}
