# Actions

`app.*` is the recommended surface. Actions run in the host, may make several Slack calls, and return compact JSON. Raw `slack.*` calls remain available for anything allowlisted.

## `app.whoami()`

Returns the authenticated user and workspace.

```js
return await app.whoami();
```

## `app.findUser(query)`

Accepts an id, an email, or a name. Names use `assistant.search.context` first, then a capped directory scan.

```js
return await app.findUser("jane doe");
```

```json
{
  "user": {
    "id": "U123ABC",
    "name": "jane.doe",
    "real_name": "Jane Doe",
    "email": "jane.doe@example.com"
  }
}
```

When several users match, `user` is `null` and `matches` holds up to five candidates.

## `app.findChannel(query)`

```js
return await app.findChannel("oncall");
```

Accepts `#name`, a name fragment, or a channel id.

## `app.dm(user, text, options)`

```js
await app.dm("jane doe", "hi");
await app.dm(["U123ABC", "U456DEF"], "sync?");
await app.dm("jane doe", "hi", { client_msg_id: "<id from ambiguous_result>" });
```

Opens the conversation, then posts. Accepts an id, email, name, array, or comma-separated string.

## `app.post(to, text, options)`

```js
await app.post("#oncall", "deploying now");
await app.post("@jane doe", "ping");
await app.post("C123ABC", "reply", { thread_ts: "1699999999.000000" });
await app.post("#oncall", "retry", { client_msg_id: "<id from ambiguous_result>" });
```

`to` may be a channel name, `#name`, `@user`, `C…`, `D…`, `G…`, or `U…`. Pass `client_msg_id` only when deliberately retrying a message whose previous result was `ambiguous_result`.

## `app.thread(channel, ts, limit)`

```js
return await app.thread("#oncall", "1699999999.000000", 50);
```

Returns `{ channel, count, messages }` with user names resolved.

## `app.readLink(url)`

```js
return await app.readLink("https://workspace.slack.com/archives/C123/p1699999999000000");
```

Parses the permalink, fetches the parent message and its thread, and resolves names. `thread_ts` is respected.

## `app.sendFile(options)`

```js
await app.sendFile({ to: "#oncall", path: "./error.log", comment: "from the incident" });
await app.sendFile({ to: "@jane.doe", content: "hello", filename: "note.txt" });
```

`to` accepts the same targets as `app.post`. Either `path` or `content` is required. The file is read in the host and capped at 20 MiB.

Path uploads are disabled by default. Set `SLACK_CODEMODE_UPLOAD_ROOTS` to a colon-separated list of allowed directories. Paths are resolved with `realpath`, then checked against those roots. Credential, secret, and system paths are always rejected.

## Canvas

```js
const { canvas_id, content } = await app.canvas.read("F1234ABCD");
const { comments } = await app.canvas.comments("F1234ABCD");
const { canvas_id: created } = await app.canvas.create("Oncall 42", "# Week 42");
await app.canvas.append(canvas_id, "- shipped the fix");
const { sections } = await app.canvas.sections(canvas_id, "Status");
await app.canvas.edit(canvas_id, [{ operation: "insert_at_end", document_content: { type: "markdown", markdown: "done" } }]);
```

Canvas content can be read as markdown or HTML. Canvas comments have no API of their own, but a canvas attached to a channel stores its comments as messages in that channel. `app.canvas.comments` resolves the channel with `files.info`, reads the history and threads, and returns the comments. Standalone canvases have no channel and therefore no readable comments.

## Raw methods

```js
return await slack.conversations.history({ channel: "C123", limit: 20 });
return await api.call("conversations.info", { channel: "C123" });
```

Raw methods must be on `allowlist.json`.

## Errors

Actions throw objects that reach the guest as `Error` with fields:

| Field | Meaning |
|---|---|
| `message` | Human-readable reason |
| `code` | `invalid_input`, `not_found`, `ambiguous`, `ambiguous_result`, `cancelled`, `not_allowed`, `missing_scope`, `ratelimited`, `not_configured`, `internal_error` |
| `needed` | Slack scopes that would satisfy the call |
| `provided` | Scopes on the token |
| `matches` | Candidate users or channels for ambiguous lookups |
| `client_msg_id` | Reuse token for a message whose send result is unknown |

The guest error message is what the MCP tool returns, so an agent can correct itself without another round trip.

Writes are never retried after a timeout, network error, 5xx, or non-JSON response, because Slack may already have applied them. Those failures return `ambiguous_result`. Do not retry a write blindly. For `chat.postMessage`, pass the returned `client_msg_id` on a deliberate retry. `canvases.create` has no idempotency key, so check for the canvas before creating another.
