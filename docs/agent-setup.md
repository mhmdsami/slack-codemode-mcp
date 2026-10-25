# Agent setup

Instructions for a coding agent asked to install and register Slack Code Mode MCP on a machine. Run the steps in order. Stop and ask the human at every step marked human-only.

## Preconditions

- macOS arm64 or Linux. Windows is not supported.
- Node.js 20.12 or newer.
- celld v0.6.2 on `PATH`.
- This repository checked out locally.

```bash
node --version
celld --version
```

If celld is missing, stop. The human installs it. Do not use sudo, edit shell profiles, or install global packages.

## 1. Install dependencies

```bash
npm ci
```

## 2. Confirm the Slack app is configured (human-only)

The server needs a Slack internal app with PKCE enabled and its Client ID in `.env`.

```bash
test -f .env && grep -q '^SLACK_CLIENT_ID=.' .env && echo configured || echo missing
```

If this prints `missing`, stop and ask the human for the Client ID. Do not create a Slack app, do not request a client secret, and do not write secrets anywhere except `.env`.

## 3. Authenticate (human-only consent)

Check whether a token already exists:

```bash
npm run doctor
```

If the output starts with `No Slack token`, run:

```bash
npm run auth
```

A browser opens. Tell the human to approve the app, then wait for the command to finish. Do not run this in CI, do not capture the token, and do not print `.env`.

## 4. Verify

```bash
npm run doctor
```

Every line must be `✓`. If a line reports `missing_scope`, stop: the human adds that scope in the Slack app, then re-runs `npm run auth`.

## 5. Register

Export the repository path and use the block for the harness in use.

```bash
REPO=/absolute/path/to/slack-codemode-mcp
```

### Claude Code

```bash
claude mcp add --scope user slack-codemode-mcp -- node "$REPO/mcp/server.mjs"
```

`--scope user` is required. Without it, the server is limited to the current directory.

### Codex

```bash
codex mcp add slack-codemode-mcp -- node "$REPO/mcp/server.mjs"
```

### OpenCode

```bash
opencode mcp add slack-codemode-mcp --global -- node "$REPO/mcp/server.mjs"
```

### Amp

```bash
amp mcp add slack-codemode-mcp -- node "$REPO/mcp/server.mjs"
```

### Pi

```bash
pi mcp add slack-codemode-mcp -- node "$REPO/mcp/server.mjs"
```

### Antigravity

```bash
agy mcp add slack-codemode-mcp node "$REPO/mcp/server.mjs"
```

### Zed

Add to `~/.config/zed/settings.json`:

```jsonc
"context_servers": {
  "slack-codemode-mcp": {
    "command": "node",
    "args": ["/absolute/path/to/slack-codemode-mcp/mcp/server.mjs"]
  }
}
```

Confirm the entry exists:

```bash
claude mcp list
codex mcp list
opencode mcp list
amp mcp list
pi mcp list
agy mcp list
```

## 6. Smoke test

Ask the harness to run this through the MCP:

```js
return await app.whoami();
```

Expect the authenticated user and workspace. If the tool is not listed, restart the harness session; MCP configuration is read at process start.

## Rules

- Never print, copy, or commit the Slack token.
- Never commit `.env`.
- Do not change `allowlist.json`, scopes, or credentials unless the human asks.
- Do not install global packages or edit shell profiles.
- If a command fails, report the exact error and stop.

## Troubleshooting

| Symptom | Action |
|---|---|
| `celld was not found` | Ask the human to install celld v0.6.2 or set `SLACK_CODEMODE_CELLD_BIN`. |
| `missing_scope` | Human adds the scope, then `npm run auth`. |
| `invalid_arguments` | The client retries form-encoded automatically; report the method and arguments. |
| `ratelimited` | Wait for the retry window; prefer `app.findUser` over directory scans. |
| Server missing in Claude | Re-add with `--scope user`, then restart the session. |
| Server `unknown` in Codex | `codex app-server daemon restart`, then start a new thread. |
| `Invalid permissions requested` | The app is missing a scope or PKCE is off. Stop and tell the human. |
