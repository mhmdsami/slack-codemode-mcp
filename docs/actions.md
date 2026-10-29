# Actions

`app.*` is the easiest way to use this server. An action runs in the host, can make several Slack calls, and returns small JSON.

Use `slack.*` or `api.call` only when an action does not cover what you need.

## Lookups

### `app.whoami()`

Returns the user and workspace for the stored token.

```js
return await app.whoami();
```

```json
{
  "user": "jane.doe",
  "user_id": "U123ABC",
  "team": "Acme",
  "team_id": "T123ABC"
}
```

### `app.findUser(query)`

Accepts a user id, an email, or a name.

```js
return await app.findUser("jane doe");
return await app.findUser("jane.doe@example.com");
return await app.findUser("U123ABC");
```

A single match looks like this:

```json
{
  "user": {
    "id": "U123ABC",
    "name": "jane.doe",
    "real_name": "Jane Doe",
    "display_name": "jane",
    "email": "jane.doe@example.com"
  }
}
```

When several users match, `user` is `null` and `matches` holds up to five candidates.

```json
{
  "user": null,
  "matches": [{ "id": "U123ABC", "name": "jane.doe" }],
  "total": 2,
  "complete": true
}
```

`complete` is `false` when the directory scan hit its page cap. A `not_found` error also says when the cap was reached, so a miss is not final.

### `app.findChannel(query)`

Accepts a channel id, a `#name`, or part of a name.

```js
return await app.findChannel("oncall");
return await app.findChannel("#team-eng");
return await app.findChannel("C123ABC");
```

The result uses the same `matches` and `complete` fields as `findUser`.

## Messages

### `app.dm(user, text, options)`

Opens a DM and posts a message. The user can be an id, an email, a name, an array, or a comma-separated string.

```js
await app.dm("jane doe", "hi");
await app.dm(["U123ABC", "U456DEF"], "sync?");
await app.dm("jane doe", "hi", { client_msg_id: "<id from ambiguous_result>" });
```

### `app.post(to, text, options)`

Posts to a channel, a DM, or a thread.

```js
await app.post("#oncall", "deploying now");
await app.post("@jane doe", "ping");
await app.post("C123ABC", "reply", { thread_ts: "1699999999.000000" });
await app.post("#oncall", "retry", { client_msg_id: "<id from ambiguous_result>" });
```

`to` accepts a channel name, `#name`, `@user`, or a channel id such as `C123ABC`, `D123ABC`, or `G123ABC`.

Pass `client_msg_id` only when you retry a message whose last result was `ambiguous_result`.

### `app.edit(channel, ts, text, options)`

Updates a message with `chat.update`.

```js
await app.edit("#oncall", "1699999999.000000", "fixed the typo");
```

```js
await app.edit("C123ABC", "1699999999.000000", "", {
  blocks: [{ type: "section", text: { type: "mrkdwn", text: "new body" } }],
});
```

Provide `text` or `blocks`. `reply_broadcast` is passed through.

### `app.search(query, options)`

Searches messages with `search.messages`.

```js
return await app.search("deploy failed", { count: 20, sort: "timestamp" });
```

```json
{
  "total": 42,
  "page": 1,
  "pages": 3,
  "count": 20,
  "matches": [
    {
      "channel": "team-eng",
      "channel_id": "C123ABC",
      "user": "jane.doe",
      "user_id": "U123ABC",
      "ts": "1699999999.000000",
      "text": "the deploy failed",
      "permalink": "https://workspace.slack.com/archives/C123ABC/p1699999999000000"
    }
  ]
}
```

`count` is clamped to 1–100 and `page` to 1–100. Sort by `score` or `timestamp`, in `asc` or `desc` order. Set `highlight: true` to keep Slack's match markers in `text`. Match text is unescaped, and mentions and links are rendered.

### `app.thread(channel, ts, limit, options)`

Reads a thread and returns a condensed transcript.

```js
return await app.thread("#oncall", "1699999999.000000", 50);
```

```json
{
  "channel": "C123ABC",
  "count": 3,
  "has_more": false,
  "next_cursor": null,
  "text": "10-20 05:25 Jane Doe: the parent message [4 replies]\n10-20 05:31 John Smith: a reply\n10-20 05:33 Jane Doe: another reply"
}
```

The transcript is one line per message: UTC time, author, text, and a short note for files, attachments, reactions, edits, and reply counts. Mentions become names, Slack entities are unescaped, and links keep their label and URL.

This is the default because it is much smaller than raw message objects, and reading plus summarizing is the common case.

When you need fields, ask for JSON:

```js
return await app.thread("#oncall", "1699999999.000000", 50, { format: "json" });
```

```json
{
  "channel": "C123ABC",
  "count": 2,
  "has_more": false,
  "messages": [
    {
      "user": "Jane Doe",
      "user_id": "U123ABC",
      "ts": "1699999999.000000",
      "text": "the parent message",
      "files": [],
      "attachments": 0,
      "reactions": [],
      "edited": false,
      "subtype": null,
      "reply_count": 1
    }
  ]
}
```

`limit` is clamped to 1–200 and defaults to 50. When `has_more` is `true`, pass `next_cursor` to a raw `slack.conversations.replies` call.

### `app.readLink(url, options)`

Reads a message from a Slack permalink. If the message has a thread, the whole thread is returned.

```js
return await app.readLink("https://workspace.slack.com/archives/C123ABC/p1699999999000000");
```

The result uses the same condensed `text` as `app.thread`, plus `ts` and `thread_ts`. Pass `{ format: "json" }` for structured messages. JSON messages also include `is_thread_parent`.

The result includes `has_more`.

## Files

### `app.sendFile(options)`

Uploads a file to a channel, a DM, or a thread.

```js
await app.sendFile({ to: "#oncall", path: "./error.log", comment: "from the incident" });
await app.sendFile({ to: "@jane.doe", content: "hello", filename: "note.txt" });
await app.sendFile({ to: "#oncall", content: "log", thread_ts: "1699999999.000000" });
```

Provide `path` or `content`. The host reads the file and caps it at 20 MiB.

Path uploads are off by default. To allow them, set a colon-separated list of directories:

```bash
export SLACK_CODEMODE_UPLOAD_ROOTS="$HOME/logs:/tmp/slack-uploads"
```

Paths are resolved with `realpath` and checked against those roots. Credential, secret, and system paths are always rejected.

## Canvas

### `app.canvas.create(title, markdown, channel_id)`

```js
const { canvas_id } = await app.canvas.create("Oncall 42", "# Week 42");
const { canvas_id: inChannel } = await app.canvas.create("Oncall 42", "# Week 42", "C123ABC");
```

The third argument is optional. Pass a channel id to create the canvas there.

### `app.canvas.read(canvas_id, content_type)`

```js
const { content } = await app.canvas.read("F1234ABCD");
const { content: html } = await app.canvas.read("F1234ABCD", "html");
```

`content_type` is `markdown` (default) or `html`.

### `app.canvas.comments(canvas_id, limit)`

Reads the comments on a canvas that is shared in a channel.

```js
const { count, comments } = await app.canvas.comments("F1234ABCD", 100);
```

```json
{
  "canvas_id": "F1234ABCD",
  "channels": ["C123ABC"],
  "count": 2,
  "has_more": false,
  "comments": [
    {
      "channel": "C123ABC",
      "user": "Jane Doe",
      "user_id": "U123ABC",
      "ts": "1699999999.000000",
      "text": "can we ship this?"
    }
  ]
}
```

Slack posts a message when someone shares a canvas in a channel. Comments are replies to that message. Comment text is unescaped and mentions are resolved.

This action finds the share message from the canvas metadata, then reads only those replies. It does not scan the channel, so unrelated messages never appear.

A few details:

- `limit` applies per share thread and is clamped to 1–200.
- Up to ten share threads are read per call.
- Channels that cannot be read are listed in `skipped`.
- A canvas that is not shared has no comment thread. The result is `count: 0` with a note.

### `app.canvas.append(canvas_id, markdown)`

Adds markdown to the end of a canvas.

```js
await app.canvas.append(canvas_id, "- shipped the fix");
```

### `app.canvas.edit(canvas_id, changes)`

Applies one or more changes.

```js
await app.canvas.edit(canvas_id, [
  {
    operation: "replace",
    section_id: "temp",
    document_content: { type: "markdown", markdown: "done" },
  },
]);
```

Each change is checked against Slack's change types before the API call:

| Operation | Required fields |
|---|---|
| `insert_after` | `section_id`, `document_content` |
| `insert_before` | `section_id`, `document_content` |
| `insert_at_start` | `document_content` |
| `insert_at_end` | `document_content` |
| `replace` | `document_content` (optional `section_id`) |
| `delete` | `section_id` |

`document_content` must be markdown:

```js
{ type: "markdown", markdown: "# Section" }
```

At most 100 operations are accepted.

### `app.canvas.share(canvas_id, options)`

Gives channels or users access to a canvas with `canvases.access.set`.

```js
await app.canvas.share("F1234ABCD", { channel_ids: ["C123ABC"], access_level: "write" });
await app.canvas.share("F1234ABCD", { user_ids: ["U123ABC"] });
```

`access_level` is `read` (default) or `write`. Provide `channel_ids`, `user_ids`, or both.

### `app.canvas.sections(canvas_id, text, section_types)`

Finds sections in a canvas.

```js
const { sections } = await app.canvas.sections(canvas_id, "Status");
const { sections: headers } = await app.canvas.sections(canvas_id, undefined, ["h1", "h2"]);
```

Provide `text`, `section_types`, or both. `section_types` accepts one to three values: `any_header`, `h1`, `h2`, `h3`.

## Raw methods

Anything on the allowlist is still available as a raw call.

```js
return await slack.conversations.history({ channel: "C123ABC", limit: 20 });
return await api.call("conversations.info", { channel: "C123ABC" });
```

To see what is allowlisted and what arguments a method takes, use the `search` tool.

## Input rules

Actions reject bad input before calling Slack. This saves a round trip and gives a clearer error.

| Input | Rule |
|---|---|
| Ids | An uppercase prefix plus alphanumerics, for example `C123ABC` |
| Timestamps | `1699999999.000000` |
| Page limits | Clamped to 1–200 |
| Message text | At most 40,000 characters |
| Canvas markdown | At most 60,000 characters |
| Uploads | At most 20 MiB |

Each bridge call is also capped at 64 KiB. Large markdown or blocks can exceed that. Split the work if you see `request_too_large`.

## Errors

Actions throw an `Error` with a `code` and a readable `message`. The guest receives these fields:

| Field | Meaning |
|---|---|
| `message` | What went wrong |
| `code` | A machine-readable reason |
| `needed` | Scopes that would make the call work |
| `provided` | Scopes on the token |
| `matches` | Candidates for an ambiguous lookup |
| `client_msg_id` | Reuse token for a message whose send result is unknown |

Codes you may see:

```text
invalid_input  not_found  ambiguous  ambiguous_result  cancelled
not_allowed    missing_scope  ratelimited  not_configured
request_too_large  internal_error
```

The message is what the MCP client shows the agent, so it tries to include enough detail to correct the call without another round trip.

Writes are never retried after a timeout, a network error, a 5xx, or a non-JSON response. Slack may already have applied the write, so the action returns `ambiguous_result`.

Do not retry a write blindly. For messages, pass the returned `client_msg_id` on a deliberate retry:

```js
await app.post("#oncall", "retry", { client_msg_id: "<id from ambiguous_result>" });
```

`canvases.create` has no idempotency key. Check for an existing canvas before creating another.
