# Authentication

Slack issues user tokens through OAuth. This server uses **PKCE**, which makes the app a public client and removes the client secret entirely.

## Slack app

1. Create an internal app at <https://api.slack.com/apps>.
2. Enable **PKCE** under OAuth & Permissions. This is one-way.
3. Add the redirect URL `http://localhost:33417/callback`.
4. Add the user token scopes below.

## Scopes

The authoritative list is printed by `npm run scopes`, which reads it from `scripts/auth.mjs`.

```
chat:write
channels:read        channels:history
groups:read          groups:history
im:read              im:write             im:history
mpim:read            mpim:write           mpim:history
search:read          search:read.users
users:read           users:read.email
usergroups:read
files:read           files:write
canvases:read        canvases:write
```

| Method | Scope |
|---|---|
| `chat.postMessage`, `chat.update` | `chat:write` |
| `chat.getPermalink` | none |
| `conversations.list`, `conversations.info` | `channels:read`, `groups:read`, `im:read`, `mpim:read` |
| `conversations.history`, `conversations.replies` | `channels:history`, `groups:history`, `im:history`, `mpim:history` |
| `conversations.open` | `im:write`, `mpim:write` |
| `search.messages` | `search:read` |
| `assistant.search.context` | `search:read.users` |
| `users.info`, `users.list`, `auth.test` | `users:read` |
| `users.lookupByEmail` | `users:read.email` |
| `usergroups.list` | `usergroups:read` |
| `files.info` | `files:read` |
| `files.getUploadURLExternal`, `files.completeUploadExternal` | `files:write` |
| `canvases.create`, `canvases.edit` | `canvases:write` |
| `canvases.sections.lookup` | `canvases:read` |

## Flow

```bash
SLACK_CLIENT_ID=... npm run auth
```

1. Builds `https://slack.com/oauth/v2/authorize` with `user_scope`, `state`, `code_challenge`, and `code_challenge_method=S256`.
2. Starts a loopback listener on port 33417.
3. Validates `state` and exchanges the code at `oauth.v2.access` with `code_verifier` and no `client_secret`.
4. Calls `auth.test` and stores the token.

`--dry-run` prints the URL and exits. `--no-open` prints it without launching a browser. `SLACK_OAUTH_PORT` overrides the callback port.

## Token storage

Resolution order:

1. `SLACK_USER_TOKEN`
2. `SLACK_TOKEN_CMD` (prints the token)
3. macOS Keychain (`Slack Codemode MCP Token`)
4. `~/.config/slack-codemode/token` (mode 0600, non-macOS)

Storage on success:

- macOS: Keychain
- Linux: the 0600 file
- Any platform: `SLACK_TOKEN_STORE_CMD` receives the token on stdin

## Verification

```bash
npm run doctor
```

The checker probes one method per area with fixture ids. `channel_not_found`, `user_not_found`, and `canvas_not_found` count as passes: the scope worked, the fixture did not.

## Colleagues

Each person runs the server on their own machine with their own user token. With PKCE they need only the Client ID:

```
SLACK_CLIENT_ID=...
```

Then `npm run auth`, `npm run doctor`, and register the MCP. Nothing sensitive is shared.

## Token rotation

When the app has rotation enabled, Slack returns an access token, a refresh token, and an expiry. All three are stored together, plus the Client ID.

Before a call, if the access token expires within 60 seconds, the server refreshes it. If Slack answers `token_expired` or `invalid_auth`, the server refreshes once and retries the call. Refreshes time out after 20 seconds, and the lock holder re-reads the stored bundle before rotating.

A lock file at `~/.config/slack-codemode/refresh.lock` coordinates refresh across harness processes, so two MCP servers do not rotate the same refresh token at once. A process that loses the race reuses the token the winner stored.

Refresh tokens expire after 30 days with PKCE. When refresh fails with `invalid_refresh_token`, run `npm run auth` again.

`SLACK_USER_TOKEN` and `SLACK_TOKEN_CMD` supply a token without a refresh token, so they cannot renew; re-run auth when those expire.
