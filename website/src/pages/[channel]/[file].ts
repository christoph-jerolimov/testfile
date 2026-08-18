// The schema assets: every schema from src/schemas.ts, under every channel
// prefix - /v0/testfile.schema.json, /current/testrun.schema.json and so on.
// Static file endpoints, so the built site contains the plain .json files
// and any host serves them with a JSON content type.
import type { APIRoute } from "astro";
import { schemaChannels, schemaFiles } from "../../schemas";

export function getStaticPaths() {
  return schemaChannels.flatMap((channel) =>
    schemaFiles.map((schema) => ({
      params: { channel, file: schema.file },
      props: { source: schema.source },
    })),
  );
}

export const GET: APIRoute = ({ props }) =>
  new Response(props.source, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
