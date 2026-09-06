import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { buildEventSchema, closeAfterRelease, recordBuildEvent, releaseOperationSchema } from "./build_failure_policy.js";
import { createInfraiErrors, InfraiError } from "./infrai_errors.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const client = createInfraiErrors(apiKey);

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/build-events") {
      const result = await recordBuildEvent(buildEventSchema.parse(await readJson(request)), client);
      send(response, 202, result);
      return;
    }
    if (request.method === "POST" && request.url === "/release-operations") {
      const result = await closeAfterRelease(releaseOperationSchema.parse(await readJson(request)), client);
      send(response, 200, result);
      return;
    }
    send(response, 404, { error: "route not found" });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: "invalid request body" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, message: error.message });
      return;
    }
    send(response, 502, { error: "diagnostic backend request failed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`diagnostic service listening on http://localhost:${port}`));
