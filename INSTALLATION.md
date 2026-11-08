# Installation

This server is distributed through GitHub Releases. Each release provides a package tarball and `SHA256SUMS`.

There is no npm registry package. npm is used only to install the downloaded tarball.

## Requirements

- Node.js 20.12 or newer
- celld 0.6.2 or newer
- macOS arm64, Linux x86_64, or Linux arm64
- A Slack internal app with PKCE enabled

Windows and macOS x64 are not supported, because celld does not publish binaries for them.

## Download the release

Set the release version and download both assets:

```bash
VERSION=1.0.0
BASE="https://github.com/mhmdsami/slack-codemode-mcp/releases/download/v$VERSION"
curl -LO "$BASE/slack-codemode-mcp-$VERSION.tgz"
curl -LO "$BASE/SHA256SUMS"
```

Verify the checksum.

On macOS:

```bash
shasum -a 256 -c SHA256SUMS
```

On Linux:

```bash
sha256sum -c SHA256SUMS
```

Replace `1.0.0` with the release version you want.

## Install

### Global install, recommended

```bash
npm install -g "./slack-codemode-mcp-$VERSION.tgz"
```

```bash
slack-codemode-mcp --version
```

The package provides three commands:

```text
slack-codemode-mcp      the MCP server
slack-codemode-auth     Slack authorization
slack-codemode-doctor   token and scope check
```

If `npm install -g` fails with `EACCES`, use a Node version manager or set a user prefix:

```bash
npm config set prefix "$HOME/.local"
```

Make sure `$HOME/.local/bin` is on `PATH`.

### Local install, no global npm

Extract the package and install its runtime dependencies:

```bash
INSTALL_DIR="$HOME/tools/slack-codemode-mcp"
mkdir -p "$INSTALL_DIR"
tar -xzf "slack-codemode-mcp-$VERSION.tgz" -C "$INSTALL_DIR" --strip-components=1
(cd "$INSTALL_DIR" && npm install --omit=dev)
```

```bash
node "$INSTALL_DIR/mcp/server.mjs" --version
```

Use the `node` paths for auth and doctor:

```bash
node "$INSTALL_DIR/scripts/auth.mjs"
node "$INSTALL_DIR/scripts/check.mjs"
```

Use this form when you cannot or do not want a global npm install.

## Install celld

celld is a separate binary. Download the asset for your platform from:

<https://github.com/denoland/celld/releases>

Current assets:

```text
celld-aarch64-apple-darwin.gz       macOS arm64
celld-x86_64-unknown-linux-gnu.gz   Linux x86_64
celld-aarch64-unknown-linux-gnu.gz  Linux arm64
```

### macOS arm64

```bash
mkdir -p "$HOME/.local/bin"
curl -L -o /tmp/celld.gz \
  https://github.com/denoland/celld/releases/download/v0.6.3/celld-aarch64-apple-darwin.gz
gunzip -c /tmp/celld.gz > "$HOME/.local/bin/celld"
chmod +x "$HOME/.local/bin/celld"
celld --version
```

### Linux x86_64

```bash
mkdir -p "$HOME/.local/bin"
curl -L -o /tmp/celld.gz \
  https://github.com/denoland/celld/releases/download/v0.6.3/celld-x86_64-unknown-linux-gnu.gz
gunzip -c /tmp/celld.gz > "$HOME/.local/bin/celld"
chmod +x "$HOME/.local/bin/celld"
celld --version
```

### Linux arm64

```bash
mkdir -p "$HOME/.local/bin"
curl -L -o /tmp/celld.gz \
  https://github.com/denoland/celld/releases/download/v0.6.3/celld-aarch64-unknown-linux-gnu.gz
gunzip -c /tmp/celld.gz > "$HOME/.local/bin/celld"
chmod +x "$HOME/.local/bin/celld"
celld --version
```

If `celld --version` is not found, add `$HOME/.local/bin` to `PATH`.

If `celld` is not on `PATH`, point the server at it:

```bash
export SLACK_CODEMODE_CELLD_BIN="$HOME/.local/bin/celld"
```

## Configure the Slack app

1. Create an internal app at <https://api.slack.com/apps>.
2. Open **OAuth & Permissions** and enable **PKCE**. This cannot be undone.
3. Add the redirect URL `http://localhost:33417/callback`.
4. Add the user token scopes.

Print the scope list.

Global install:

```bash
slack-codemode-auth --scopes
```

Local install:

```bash
node "$INSTALL_DIR/scripts/auth.mjs" --scopes
```

Add those scopes under **User Token Scopes**, then install or reinstall the app.

## Configure the client ID

The Client ID is public. Set it in the environment:

```bash
export SLACK_CLIENT_ID=your-client-id
```

Or store it in the config directory:

```bash
mkdir -p "$HOME/.config/slack-codemode"
printf 'SLACK_CLIENT_ID=%s\n' 'your-client-id' > "$HOME/.config/slack-codemode/.env"
chmod 600 "$HOME/.config/slack-codemode/.env"
```

The environment variable wins. A `.env` in the package root is used for a source or local install; otherwise `~/.config/slack-codemode/.env` is used.

## Authenticate

Global install:

```bash
slack-codemode-auth
```

Local install:

```bash
node "$INSTALL_DIR/scripts/auth.mjs"
```

A browser opens. Approve the app and return to the terminal.

Useful flags:

```bash
slack-codemode-auth --dry-run   # print the authorize URL and exit
slack-codemode-auth --no-open   # print the URL without opening a browser
```

For the local install, pass the same flags to `scripts/auth.mjs`.

Use a different callback port:

```bash
SLACK_OAUTH_PORT=34567 slack-codemode-auth
```

The token bundle is stored in:

```text
~/.config/slack-codemode/token
```

It is written with mode 0600. Rotating tokens refresh automatically.

## Verify

Global install:

```bash
slack-codemode-doctor
```

Local install:

```bash
node "$INSTALL_DIR/scripts/check.mjs"
```

Every line should be `✓`.

`channel_not_found`, `user_not_found`, and `canvas_not_found` count as passes. The scope worked and the fixture does not exist.

## Register the server

Global install, resolve the command:

```bash
command -v slack-codemode-mcp
```

Use that path in your MCP client.

Local install, use:

```text
node /absolute/path/to/slack-codemode-mcp/mcp/server.mjs
```

### Claude Code

Global:

```bash
claude mcp add --scope user slack-codemode-mcp -- "$(command -v slack-codemode-mcp)"
```

Local:

```bash
claude mcp add --scope user slack-codemode-mcp -- node "$INSTALL_DIR/mcp/server.mjs"
```

### Codex

Global:

```bash
codex mcp add slack-codemode-mcp -- "$(command -v slack-codemode-mcp)"
```

Local:

```bash
codex mcp add slack-codemode-mcp -- node "$INSTALL_DIR/mcp/server.mjs"
```

### OpenCode

Global:

```bash
opencode mcp add slack-codemode-mcp --global -- "$(command -v slack-codemode-mcp)"
```

Local:

```bash
opencode mcp add slack-codemode-mcp --global -- node "$INSTALL_DIR/mcp/server.mjs"
```

### Zed

Add this to `~/.config/zed/settings.json`:

```jsonc
"context_servers": {
  "slack-codemode-mcp": {
    "command": "/absolute/path/from/command -v",
    "args": []
  }
}
```

Restart the client. MCP configuration is read at startup.

## Smoke test

Ask the agent to run this through the MCP:

```js
return await app.whoami();
```

Expect your user and workspace.

## Upgrade

Download the new tarball and checksums, then verify them the same way.

Global install:

```bash
VERSION=1.0.1
BASE="https://github.com/mhmdsami/slack-codemode-mcp/releases/download/v$VERSION"
curl -LO "$BASE/slack-codemode-mcp-$VERSION.tgz"
curl -LO "$BASE/SHA256SUMS"
shasum -a 256 -c SHA256SUMS
npm install -g "./slack-codemode-mcp-$VERSION.tgz"
slack-codemode-mcp --version
slack-codemode-doctor
```

Local install:

```bash
VERSION=1.0.1
BASE="https://github.com/mhmdsami/slack-codemode-mcp/releases/download/v$VERSION"
curl -LO "$BASE/slack-codemode-mcp-$VERSION.tgz"
curl -LO "$BASE/SHA256SUMS"
shasum -a 256 -c SHA256SUMS
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
tar -xzf "slack-codemode-mcp-$VERSION.tgz" -C "$INSTALL_DIR" --strip-components=1
(cd "$INSTALL_DIR" && npm install --omit=dev)
node "$INSTALL_DIR/mcp/server.mjs" --version
node "$INSTALL_DIR/scripts/check.mjs"
```

Use `sha256sum -c` instead of `shasum` on Linux.

Restart the MCP client so it loads the new server.

Your token and config live in `~/.config/slack-codemode` and survive upgrades.

## Uninstall

Global install:

```bash
npm uninstall -g slack-codemode-mcp
```

Local install:

```bash
rm -rf "$HOME/tools/slack-codemode-mcp"
```

The token is not removed. To delete it:

```bash
rm -rf "$HOME/.config/slack-codemode"
```

Also revoke the app in Slack under **Manage apps** if you want to invalidate the token remotely.

celld is separate. Remove `~/.local/bin/celld` if no other tool uses it.

## Troubleshooting

- [Troubleshooting](docs/troubleshooting.md)
- `celld was not found`: install celld or set `SLACK_CODEMODE_CELLD_BIN`.
- `missing_scope`: add the scope, then re-run the auth command.
- The server is missing in Claude: add it with `--scope user` and restart the session.

## Distribution status

GitHub Releases is the only distribution channel. There is no npm registry package. Docker images and standalone bundles are not available yet.
