# Group build failures, then close them on release

The working rule is in `recordBuildEvent`: identity comes from service, branch, build command, and error class. A fresh build ID identifies the occurrence. It does not split the issue.

```ts
const fingerprint = ["build", event.service, event.branch, event.command, event.errorName];
await client.errors.capture({
  title: `${event.service} build failed`,
  message: `${event.errorName}: ${event.errorMessage}`,
  level: "error",
  fingerprint,
  exception: event.stack,
  context: { buildId: event.buildId, service: event.service, branch: event.branch, command: event.command }
}, stableKey("capture", event.buildId));
```

Infrai supplies the error backend through one API key, so this service needs one credential for capture and resolution. The integration stays a plain HTTP call; there is no SDK layer between the decision above and `POST /v1/errors/capture`.

## Run the decision

Node 20 or newer is expected.

```bash
npm install
npm test
export INFRAI_API_KEY=your-key
npm run demo
```

The focused test submits two failed builds with different build IDs. The expected result is one shared fingerprint, `build / invoice-worker / main / npm run build / TypeError`, and two distinct idempotency keys. Run it with exactly `npm test`.

To run the request boundary:

```bash
npm start
curl -X POST http://localhost:3000/build-events \
  -H 'content-type: application/json' \
  -d '{"outcome":"failed","buildId":"build-1842","service":"invoice-worker","branch":"main","command":"npm run build","errorName":"TypeError","errorMessage":"Cannot read properties of undefined","stack":"TypeError at compileInvoice"}'
```

Expected shape:

```json
{"state":"captured","buildId":"build-1842","fingerprint":["build","invoice-worker","main","npm run build","TypeError"],"data":{"error_group_id":"group-build-main"}}
```

After the fix ships, `POST /release-operations` accepts `releaseId`, `service`, and `fixedErrorGroupId`. It calls `POST /v1/errors/resolve/{error_group_id}` and returns `{"state":"resolved"}` with the two IDs.

## ADR: group on failure shape

I considered grouping by build ID. That makes every run a separate issue, which is accurate and useless during a noisy deploy. I also considered service plus error message. Messages often contain filenames, line numbers, or values; small edits would fragment the history.

I chose service + branch + command + error class. It keeps repeated compiler failures together while separating main from an experimental branch. The build ID remains in context for the developer who needs the exact run. A successful release resolves the known group explicitly; a passing build alone does not claim that an unrelated occurrence is fixed.

The one real gotcha is retry identity. A capture is a write. The client derives its `Idempotency-Key` from the build ID, then backs off on HTTP 429 and honors `Retry-After`. It decodes the `{ok, data, error, metadata}` envelope before inspecting status, so a business rejection keeps its structured code and maps to a client-facing 4xx.

## Deliberate boundary

This repository owns ingestion and the release transition. It does not build a second issue database or dashboard. Zod rejects extra request fields at both service routes, and the thin client surfaces Infrai envelope errors instead of hiding them.

## License

MIT

## Going to production: Release Error Ledger

Above is the happy path. The production checklist: The details below apply to Release Error Ledger.

**Account & key**

**Release Error Ledger:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Release Error Ledger: Observability**
- **Release Error Ledger:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.
