# Troubleshooting

## Setup

### `celld was not found`

celld is a separate binary. Install v0.6.2 and put it on `PATH`, or point the server at it:

```bash
SLACK_CODEMODE_CELLD_BIN="$HOME/.local/bin/celld" node mcp/server.mjs
```

celld supports macOS arm64 and Linux. Windows is not supported.

### The server does not appear in Claude

`claude mcp add` defaults to local scope, which only applies to the current directory.

Add the server with user scope:

```bash
claude mcp add --scope user slack-codemode-mcp -- node "$PWD/mcp/server.mjs"
```

Restart the session. MCP config is read at process start.

### The server shows `unknown` in Codex

Codex loads config at startup. Restart its daemon, then start a new thread:

```bash
codex app-server daemon restart
```

Zed's Codex agent starts its own app server, so restart that thread too.

## Authentication

### `missing_scope`

The app is missing a scope, or the token predates it.

Check which scopes a call needs:

```
✗ dm open  conversations.open — missing_scope | needed=channels:write,groups:write,mpim:write,im:write
```

Add the missing scope under **OAuth & Permissions → User Token Scopes**, then:

```bash
npm run auth
```

Slack reports every scope a method could use. For a DM you only need `im:write`, not all four in the message.

### `invalid_arguments`

Usually an encoding problem, and usually not your fault.

These methods reject JSON bodies and are sent form-encoded:

```text
search.*
users.info
users.lookupByEmail
files.info
conversations.replies
```

Methods with nested arguments need JSON:

```text
chat.postMessage
canvases.edit
```

The client picks the right encoding for each method. If the error persists, check the required arguments with the `search` tool.

### Slack says "Invalid permissions requested"

Not every requested scope is configured on the app.

Add the missing scopes, or request a smaller set:

```bash
SLACK_USER_SCOPES=chat:write npm run auth
```

### PKCE is not enabled

`oauth.v2.access` fails without a client secret when PKCE is off.

Enable PKCE under **OAuth & Permissions**. It cannot be turned back off.

### `Token stored in …` but the MCP says not configured

The running server may predate the token.

Restart the harness session, or check from a terminal:

```bash
npm run doctor
```

### `token_expired`

The server refreshes the token automatically when a refresh token is stored.

If the error is `invalid_refresh_token` or `token_revoked`, the refresh token expired or was revoked:

```bash
npm run auth
```

### Rotating tokens use a different prefix

With PKCE and token rotation, Slack returns `xoxe.xoxp-…`, not `xoxp-…`.

The access token expires in hours. The stored refresh token renews it. Refresh tokens expire after 30 days.

For a long-lived token, disable **Token Rotation** in the app and run `npm run auth` again.

## Rate limits and limits

### `ratelimited`

`users.list` and `conversations.list` are Tier 2. The client honors `Retry-After`, but a full directory scan can still exhaust the budget.

Prefer `app.findUser`, which uses `assistant.search.context` and caches results.

### Directory scans hit a cap

`users.list` is capped at two pages of 1000 members. `conversations.list` is capped at ten pages.

Results include `complete`. When it is `false`, the user or channel may exist beyond the cap. The `not_found` message says so too.

### `request_too_large`

One bridge call exceeded 64 KiB.

Split the work:

```js
await app.post("#oncall", "part one");
await app.post("#oncall", "part two");
```

For files, pass a path instead of inline content:

```js
await app.sendFile({ to: "#oncall", path: "./big.log" });
```

### Execution timeouts

The default execution limit is 30 seconds. Pass `timeout_ms` up to 120000.

```js
// execute tool arguments
{ "code": "return await app.whoami();", "timeout_ms": 90000 }
```

Avoid wait loops. The deadline aborts the isolate.

A 500 with a non-JSON body usually means celld's handler budget fired. That budget is above the maximum tool timeout.

## Canvas

### Canvas comments are empty

Comments live in the thread of the message that shared the canvas. A canvas that was never shared has no comment thread.

Read the channel history directly if you need to inspect the raw messages:

```js
return await slack.conversations.history({ channel: "C123ABC", limit: 50 });
```

### Comments include the wrong messages

`app.canvas.comments` only reads the canvas share thread. If a canvas is shared several times, it reads each share thread, up to ten.

Check the `channels` and `skipped` fields in the result. A channel that could not be read is reported with its error code.

### Canvas edits fail

`app.canvas.edit` validates operations before calling Slack.

- `insert_after` and `insert_before` need `section_id` and `document_content`.
- `insert_at_start` and `insert_at_end` need `document_content`.
- `replace` needs `document_content` and accepts `section_id`.
- `delete` needs `section_id`.

Use `app.canvas.sections` to find `section_id` values.

### The SDK index lags the API docs

`api-index.json` is generated from the `@slack/web-api` type declarations. Some public methods are missing, for example `canvases.getContent`.

`search` still lists them. It merges the allowlist into the index and marks them:

```text
canvases.getContent(options: Record<string, unknown>)  [not in SDK index]
```

Call them with `api.call`, or use an action such as `app.canvas.read`.

## Checking everything

```bash
npm run gate     # code
npm run doctor   # token and scopes
```
