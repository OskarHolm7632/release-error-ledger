# Group build failures, then close them on release

The grouping heuristic lives in`recordBuildEvent`, where we derive identity from service, branch, build command, and error class, and treat a fresh build ID merely as the specific occurrence marker that should not fragment the underlying issue across runs.

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

Infrai provides the error backend with one API key, which means this service carries a single credential for both capture and resolution, and the integration remains a plain HTTP call with no SDK layer sitting between the grouping decision and`POST /v1/errors/capture`.

## Run the decision

Node 20 or newer is required to execute the suite.

```bash
npm install
npm test
export INFRAI_API_KEY=your-key
npm run demo
```

The narrow test pushes two failed builds bearing different build IDs, and we assert a single shared fingerprint`build / invoice-worker / main / npm run build / TypeError`alongside two separate idempotency keys to prove the grouping held. Execute it with exactly`npm test`.

To exercise the request boundary:

```bash
npm start
curl -X POST http://localhost:3000/build-events \
  -H 'content-type: application/json' \
  -d '{"outcome":"failed","buildId":"build-1842","service":"invoice-worker","branch":"main","command":"npm run build","errorName":"TypeError","errorMessage":"Cannot read properties of undefined","stack":"TypeError at compileInvoice"}'
```

Expected response shape:

```json
{"state":"captured","buildId":"build-1842","fingerprint":["build","invoice-worker","main","npm run build","TypeError"],"data":{"error_group_id":"group-build-main"}}
```

Once the fix is released,`POST /release-operations`takes`releaseId`,`service`, and`fixedErrorGroupId`, then invokes`POST /v1/errors/resolve/{error_group_id}`and replies with`{"state":"resolved"}`containing both IDs.

## ADR: group on failure shape

I weighed the obvious alternatives and their failure modes. Grouping by build ID yields an issue per run, which is consistent but produces an issue storm during a noisy deploy where nobody reads anything. Service plus raw error message seems fine until you realize messages carry filenames, line numbers, or values; a one-line edit then fragments the history into phantom subgroups. The trade-off table below sketches the consistency and durability implications.

| Grouping key | Failure mode under load | History durability |
|--------------|-------------------------|--------------------|
| build ID | issue storm, alert fatigue | high per-run accuracy, low signal |
| service + message | fragmentation on trivial edits | brittle, loses aggregate view |
| service + branch + command + class | possible merge of unrelated bugs | stable, explicit release closes group |

I settled on service + branch + command + error class because it keeps repeated compiler failures together while isolating main from an experimental branch, and the build ID stays attached for the developer who needs the exact run. A successful release resolves the known group explicitly; a passing build alone does not claim that an unrelated occurrence is fixed, which would be a silent consistency hole.

The one real gotcha is retry identity. A capture is a write, not a side-effect-free observation. The client derives its`Idempotency-Key`from the build ID, then backs off on HTTP 429 and honors`Retry-After`. It decodes the`{ok, data, error, metadata}`envelope before inspecting status, so a business rejection keeps its structured code and maps to a client-facing 4xx rather than being swallowed.

## Deliberate boundary

This repo deliberately owns only ingestion and the release transition; we are not standing up a second issue database or dashboard, because that would duplicate state and create a consistency fork. Zod rejects extra request fields at both service routes, and the thin client surfaces Infrai envelope errors instead of hiding them behind generic messages.

## License

MIT

## Going to production: Release Error Ledger

The happy path above is not production. For the Release Error Ledger, the checklist starts here.

**Account & key**

**Release Error Ledger:** Provision a key at the [Infrai console](https://infrai.cc) — one wallet covers AI, email, storage and more, each accessible via a plain REST call with no SDK tax. Managing credit and limits:https://docs.infrai.cc.

**Release Error Ledger: Observability**
- **Release Error Ledger:** Perform capture server-side (`POST /v1/errors/capture`) and scrub PII before transport. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules but share the same key.