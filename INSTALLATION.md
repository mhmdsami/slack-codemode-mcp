# Installation

This guide installs the published server. You do not need a source checkout.

## Requirements

- Node.js 20.12 or newer
- celld 0.6.2 or newer
- macOS arm64, Linux x86_64, or Linux arm64
- A Slack internal app with PKCE enabled

Windows and macOS x64 are not supported, because celld does not publish binaries for them.

## Install the server

From npm:

```bash
npm install -g slack-codemode-mcp
```

```bash
slack-codemode-mcp --version
```

Check the package without installing it:

```bash
npx slack-codemode-mcp@latest --version
```

Use a global install for MCP registration. The npx cache path changes between versions.

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

## Install from a release tarball

Download the tarball and checksums from GitHub Releases, then verify. Replace `1.0.0` with the release version:

```bash
TAG=v1.0.0
curl -LO "https://github.com/mhmdsami/slack-codemode-mcp/releases/download/$TAG/slack-codemode-mcp-1.0.0.tgz"
curl -LO "https://github.com/mhmdsami/slack-codemode-mcp/releases/download/$TAG/SHA256SUMS"
```

On macOS:

```bash
shasum -a 256 -c SHA256SUMS
```

On Linux:

```bash
sha256sum -c SHA256SUMS
```

Install the local tarball:

```bash
npm install -g ./slack-codemode-mcp-1.0.0.tgz
slack-codemode-mcp --version
```

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

Print the scope list:

```bash
slack-codemode-auth --scopes
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

When running from a source checkout, a `.env` in the repository root is used instead. The environment variable wins over the file.

## Authenticate

```bash
slack-codemode-auth
```

A browser opens. Approve the app and return to the terminal.

Useful flags:

```bash
slack-codemode-auth --dry-run   # print the authorize URL and exit
slack-codemode-auth --no-open   # print the URL without opening a browser
```

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

```bash
slack-codemode-doctor
```

Every line should be `✓`.

`channel_not_found`, `user_not_found`, and `canvas_not_found` count as passes. The scope worked and the fixture does not exist.

## Register the server

Resolve the installed command:

```bash
command -v slack-codemode-mcp
```

Use that path in your MCP client.

### Claude Code

```bash
claude mcp add --scope user slack-codemode-mcp -- "$(command -v slack-codemode-mcp)"
```

### Codex

```bash
codex mcp add slack-codemode-mcp -- "$(command -v slack-codemode-mcp)"
```

### OpenCode

```bash
opencode mcp add slack-codemode-mcp --global -- "$(command -v slack-codemode-mcp)"
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

```bash
npm install -g slack-codemode-mcp@latest
slack-codemode-mcp --version
slack-codemode-doctor
```

Then restart the MCP client so it loads the new server.

To stay on a specific version:

```bash
npm install -g slack-codemode-mcp@1.0.0
```

Your token and config live in `~/.config/slack-codemode` and survive upgrades.

If you installed from a tarball, install the newer tarball the same way:

```bash
npm install -g ./slack-codemode-mcp-1.0.1.tgz
```

## Uninstall

```bash
npm uninstall -g slack-codemode-mcp
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
- `missing_scope`: add the scope, then re-run `slack-codemode-auth`.
- The server is missing in Claude: add it with `--scope user` and restart the session.

## Distribution status

The server is distributed on npm and GitHub Releases. Docker images and standalone bundles are not available yet.
