import { createHash } from "node:crypto";
import { z } from "zod";
import type { InfraiErrors } from "./infrai_errors.js";

export const buildEventSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("failed"),
    buildId: z.string().min(1),
    service: z.string().min(1),
    branch: z.string().min(1),
    command: z.string().min(1),
    errorName: z.string().min(1),
    errorMessage: z.string().min(1),
    stack: z.string().min(1)
  }).strict(),
  z.object({
    outcome: z.literal("passed"),
    buildId: z.string().min(1),
    service: z.string().min(1),
    branch: z.string().min(1)
  }).strict()
]);

export const releaseOperationSchema = z.object({
  releaseId: z.string().min(1),
  service: z.string().min(1),
  fixedErrorGroupId: z.string().min(1)
}).strict();

export type BuildEvent = z.infer<typeof buildEventSchema>;
export type ReleaseOperation = z.infer<typeof releaseOperationSchema>;

function stableKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export async function recordBuildEvent(event: BuildEvent, client: InfraiErrors) {
  if (event.outcome === "passed") {
    return { state: "passed" as const, buildId: event.buildId };
  }

  const fingerprint = ["build", event.service, event.branch, event.command, event.errorName];
  const data = await client.errors.capture({
    title: `${event.service} build failed`,
    message: `${event.errorName}: ${event.errorMessage}`,
    level: "error",
    fingerprint,
    exception: event.stack,
    context: {
      buildId: event.buildId,
      service: event.service,
      branch: event.branch,
      command: event.command
    }
  }, stableKey("capture", event.buildId));

  return { state: "captured" as const, buildId: event.buildId, fingerprint, data };
}

export async function closeAfterRelease(operation: ReleaseOperation, client: InfraiErrors) {
  await client.errors.resolve(
    operation.fixedErrorGroupId,
    stableKey("resolve", operation.releaseId, operation.fixedErrorGroupId)
  );
  return {
    state: "resolved" as const,
    releaseId: operation.releaseId,
    errorGroupId: operation.fixedErrorGroupId
  };
}
