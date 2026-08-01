import React from "react";
import { Text } from "ink";
import { maskSecrets } from "../envfile.js";
import type { OutputLine } from "../output.js";
import type { ServiceStatus } from "../services.js";
import type { Session } from "../session.js";
import { describeServiceDef, type PaneContent, type ServiceRow } from "./model.js";

export const SERVICE_GLYPH: Record<ServiceStatus, { glyph: string; color: string }> = {
  pending: { glyph: "·", color: "gray" },
  starting: { glyph: "◐", color: "yellow" },
  ready: { glyph: "●", color: "green" },
  stopping: { glyph: "◌", color: "yellow" },
  stopped: { glyph: "○", color: "gray" },
  failed: { glyph: "✘", color: "red" },
};

export function ServicesPane({
  rows,
  index,
}: {
  rows: ServiceRow[];
  index: number;
}): React.ReactElement {
  return (
    <>
      <Text bold color="cyan">
        SERVICES
      </Text>
      {rows.length === 0 ? <Text dimColor>no services defined</Text> : null}
      {rows.map((row, i) => {
        const g = row.instance ? SERVICE_GLYPH[row.instance.status] : SERVICE_GLYPH.pending;
        const what = row.def.container ? row.def.container.image : (row.def.command ?? "script");
        return (
          <Text key={`svc-${i}`} inverse={i === index} wrap="truncate">
            <Text color={g.color}>{g.glyph}</Text> {row.name}
            <Text dimColor>
              {" "}
              {row.instance ? row.instance.status : "startable"} ({row.owner}) — {what}
            </Text>
          </Text>
        );
      })}
    </>
  );
}

// The detail pane for a service: resolved details plus the live log for a
// running instance, the declared configuration for a startable one.
export function servicePaneContent(row: ServiceRow | undefined, session: Session): PaneContent {
  if (!row) {
    return { title: "services", lines: [{ text: "no services defined", stream: "system" }] };
  }
  if (!row.instance) {
    return { title: `service ${row.name}`, note: "startable — runs on demand", lines: describeServiceDef(row) };
  }
  const service = row.instance;
  const secrets = [...(session.runner?.secrets ?? [])].filter((s) => s.length >= 4);
  const details: OutputLine[] = [];
  if (service.details.image) details.push({ text: `image: ${service.details.image}`, stream: "system" });
  if (service.details.ports?.length) {
    details.push({ text: `ports: ${service.details.ports.join(", ")}`, stream: "system" });
  }
  for (const [key, value] of Object.entries(service.details.env ?? {})) {
    details.push({ text: `env: ${key}=${maskSecrets(value, secrets)}`, stream: "system" });
  }
  return {
    title: `service ${service.name}`,
    note: `${service.status}${service.error ? ` — ${service.error}` : ""}`,
    lines: [...details, ...service.output.lines],
  };
}
