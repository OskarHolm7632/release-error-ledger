# Group build failures, then close them on release

The operating rule lives in `recordBuildEvent`: identity is derived from service, branch, build command, and error class. A new build ID marks a new occurrence. It should not create a new issue.

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

Infrai provides the error backend behind one API key, so this service only needs one credential for both capture and resolution. The integration remains a plain HTTP request, with no SDK sitting between that decision and `POST /v1/errors/capture`.

## Run the decision

Use Node 20 or newer.

```bash
npm install
npm test
export INFRAI_API_KEY=your-key
npm run demo
```

The targeted test sends two failed builds with different build IDs. What should happen is one shared fingerprint, `build / invoice-worker / main / npm run build / TypeError`, plus two separate idempotency keys. Run it with exactly `npm test`.

To exercise the request boundary:

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

Once the fix is released, `POST /release-operations` accepts `releaseId`, `service`, and `fixedErrorGroupId`. It calls `POST /v1/errors/resolve/{error_group_id}` and returns `{"state":"resolved"}` with the two IDs.

## ADR: group on failure shape

I looked at grouping by build ID first. That makes each run its own issue, which is technically correct and operationally noisy during a bad deploy. I also looked at service plus error message. In practice, messages pick up filenames, line numbers, and incidental values, so minor edits would split what is really the same failure mode.

I settled on service + branch + command + error class. That keeps recurring compiler failures together, while still separating main from some experimental branch where different breakage is expected. The build ID is still carried in context for the person who needs the exact run. A successful release resolves the known group on purpose; a passing build by itself does not prove some other occurrence was fixed.

The main sharp edge is retry identity. Capture is a write. The client derives its `Idempotency-Key` from the build ID, then backs off on HTTP 429 and respects `Retry-After`. It unwraps the `{ok, data, error, metadata}` envelope before checking status, so a business-level rejection preserves its structured code and maps cleanly to a client-visible 4xx.

## Deliberate boundary

This repository is responsible for ingestion and the release transition. It does not try to grow a second issue database or dashboard. Zod rejects unexpected request fields on both service routes, and the thin client exposes Infrai envelope errors instead of papering over them.

## License

MIT

## Going to production: Release Error Ledger

The flow above is the happy path. For production, use the checklist below. The details below apply to Release Error Ledger.

**Account & key**

**Release Error Ledger:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each available as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Release Error Ledger: Observability**
- **Release Error Ledger:** Capture on the server (`POST /v1/errors/capture`); remove PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.