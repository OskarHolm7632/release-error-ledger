import { recordBuildEvent } from "./build_failure_policy.js";
import { createInfraiErrors } from "./infrai_errors.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the demo");

const result = await recordBuildEvent({
  outcome: "failed",
  buildId: "build-1842",
  service: "invoice-worker",
  branch: "main",
  command: "npm run build",
  errorName: "TypeError",
  errorMessage: "Cannot read properties of undefined",
  stack: "TypeError: Cannot read properties of undefined\n    at compileInvoice (receipt_sender.ts:42:9)"
}, createInfraiErrors(apiKey));

console.log(JSON.stringify(result, null, 2));
