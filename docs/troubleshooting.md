# Troubleshooting

## Known quirks

### Rotating tokens use a different prefix

With PKCE and token rotation enabled, Slack returns `xoxe.xoxp-…`, not `xoxp-…`. The access token expires in hours, not days. The stored refresh token renews it, and refresh tokens expire after 30 days. If you want a long-lived token, disable Token Rotation in the app and re-run `npm run auth`.

### The SDK index lags the API docs

`api-index.json` is generated from `@slack/web-api` type declarations. Some public methods are missing, for example `canvases.getContent`. That is why `app.canvas.read` exists and why `search` does not list it. When a documented method is absent, call it with `api.call("method", args)` or add an action.

### Slack disagrees about request encoding

`search.*`, `users.info`, and `users.lookupByEmail` reject JSON bodies. The client retries those as form-encoded. `canvases.edit` and `chat.postMessage` need JSON for nested arguments. This is per method, not per API version.

### Canvas comments live in the channel

A canvas attached to a channel stores its comments as messages in that channel. `app.canvas.comments` resolves the channel with `files.info`, then reads history and threads. A standalone canvas has no channel, so its comments have no readable source.

### Directory scans hit a rate limit

`users.list` rate-limits after roughly two pages of 1000 members. `app.findUser` uses `assistant.search.context` and caches results instead of scanning the directory.

## `celld was not found`

Install celld v0.6.2 and put it on `PATH`, or set `SLACK_CODEMODE_CELLD_BIN`:

```bash
SLACK_CODEMODE_CELLD_BIN="$HOME/.local/bin/celld" node mcp/server.mjs
```

celld supports macOS arm64 and Linux. Windows is not supported.

## `missing_scope`

The token predates a scope, or the app does not have it. `npm run doctor` prints the needed and provided scopes:

```
✗ dm open  conversations.open — missing_scope | needed=channels:write,groups:write,mpim:write,im:write
```

Add the scope under **OAuth & Permissions → User Token Scopes**, then `npm run auth`. Slack reports the full scope set for a method; for a DM you need `im:write`, not `channels:write`.

## `invalid_arguments`

Usually an encoding problem. `search.*`, `users.info`, and `users.lookupByEmail` require form encoding; the client detects and retries. If it persists, check the method's required arguments with `search`.

## `ratelimited`

`users.list` and `conversations.list` are Tier 2. The client honors `Retry-After`, but a full directory scan can still exhaust the budget. Use `app.findUser`, which prefers `assistant.search.context` and caches results.

## `token_expired`

The server refreshes automatically when a refresh token is stored. If it still fails with `invalid_refresh_token` or `token_revoked`, the refresh token has expired or been revoked. Run `npm run auth`.

## Execution timeouts

Default execution is 30 seconds. Pass `timeout_ms` up to 120000. Avoid wait loops; the deadline aborts the isolate. A 500 with a non-JSON body usually means celld's handler budget fired, which is now above the maximum tool timeout.

## The MCP does not appear in Claude

`claude mcp add` defaults to local scope, which is tied to the current directory. Add it globally:

```bash
claude mcp add --scope user slack-codemode-mcp -- node "$PWD/mcp/server.mjs"
```

Restart the session; MCP config is read at process start.

## Codex shows `unknown`

Codex's app-server daemon loads config at startup. After adding or renaming a server:

```bash
codex app-server daemon restart
```

Then start a new thread. Zed's Codex agent spawns its own app-server; restart that thread too.

## Slack shows "Invalid permissions requested"

The requested scopes are not all configured on the app. Add them, or request a subset:

```bash
SLACK_USER_SCOPES=chat:write npm run auth
```

## PKCE is not enabled

`oauth.v2.access` without a client secret fails. Enable PKCE under OAuth & Permissions. It is one-way.

## `Token stored in …` but the MCP says not configured

The running MCP process may predate the token. Restart the harness session, or run the server manually to confirm:

```bash
npm run doctor
```

## Checking everything

```bash
npm run gate     # code
npm run doctor   # token and scopes
```
