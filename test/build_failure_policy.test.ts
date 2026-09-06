import assert from "node:assert/strict";
import test from "node:test";
import { recordBuildEvent } from "../src/build_failure_policy.js";
import type { InfraiErrors } from "../src/infrai_errors.js";

test("two runs of the same build failure choose the same grouping fingerprint", async () => {
  const captures: Array<{ payload: Record<string, unknown>; key: string }> = [];
  const client = {
    errors: {
      capture: async (payload: Record<string, unknown>, key: string) => {
        captures.push({ payload, key });
        return { error_group_id: "group-build-main" };
      },
      resolve: async () => ({})
    }
  } as InfraiErrors;

  const base = {
    outcome: "failed" as const,
    service: "invoice-worker",
    branch: "main",
    command: "npm run build",
    errorName: "TypeError",
    errorMessage: "Cannot read properties of undefined",
    stack: "TypeError at compileInvoice"
  };

  await recordBuildEvent({ ...base, buildId: "build-100" }, client);
  await recordBuildEvent({ ...base, buildId: "build-101" }, client);

  assert.deepEqual(captures[0]?.payload.fingerprint, captures[1]?.payload.fingerprint);
  assert.notEqual(captures[0]?.key, captures[1]?.key);
  assert.deepEqual(captures[0]?.payload.fingerprint,
    ["build", "invoice-worker", "main", "npm run build", "TypeError"]);
});
