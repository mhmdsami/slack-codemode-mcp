# Installation

This server is distributed through GitHub Releases. Each release provides a package tarball and `SHA256SUMS`.

There is no npm registry package.

## Requirements

- Node.js 20.12 or newer
- bash, npm, curl, tar, gunzip, and mktemp
- celld 0.6.2 or newer
- macOS arm64, Linux x86_64, or Linux arm64
- A Slack internal app with PKCE enabled

Windows and macOS x64 are not supported because celld does not publish binaries for them.

## Install with the script

```bash
curl -fsSL https://raw.githubusercontent.com/mhmdsami/slack-codemode-mcp/main/install.sh | bash
```

This installs the latest release into `~/.local` without sudo. The installer:

- checks Node.js, npm, curl, tar, gunzip, and mktemp
- downloads the release tarball and verifies `SHA256SUMS`
- installs celld for the supported platform when needed, after verifying the upstream asset digest
- leaves `~/.config/slack-codemode` unchanged

Add `$HOME/.local/bin` to `PATH` if the installer says it is missing.

Pin a release:

```bash
curl -fsSL https://raw.githubusercontent.com/mhmdsami/slack-codemode-mcp/main/install.sh \
  | bash -s -- --version 1.0.0
```

Choose a different prefix with `--prefix <dir>`. The default is `~/.local`.

Use the full path to the installed server when registering it.

## Manual install

Use this path if you want to verify each step.

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

Extract and install the runtime dependencies:

```bash
INSTALL_DIR="$HOME/tools/slack-codemode-mcp"
mkdir -p "$INSTALL_DIR"
tar -xzf "slack-codemode-mcp-$VERSION.tgz" -C "$INSTALL_DIR" --strip-components=1
(cd "$INSTALL_DIR" && npm install --omit=dev)
node "$INSTALL_DIR/mcp/server.mjs" --version
```

The manual path does not install celld. Use the installer, or install celld from <https://github.com/denoland/celld/releases>. If `celld` is not on `PATH`, set `SLACK_CODEMODE_CELLD_BIN` to its absolute path.

## Configure the Slack app

1. Create an internal app at <https://api.slack.com/apps>.
2. Open **OAuth & Permissions** and enable **PKCE**.
3. Add the redirect URL `http://localhost:33417/callback`.
4. Add the user token scopes.

Print the scopes.

Script install:

```bash
slack-codemode-auth --scopes
```

Manual install:

```bash
node "$INSTALL_DIR/scripts/auth.mjs" --scopes
```

Add those scopes under **User Token Scopes**, then install or reinstall the app.

## Configure the client ID

Set it in the environment:

```bash
export SLACK_CLIENT_ID=your-client-id
```

Or store it in the config directory:

```bash
mkdir -p "$HOME/.config/slack-codemode"
printf 'SLACK_CLIENT_ID=%s\n' 'your-client-id' > "$HOME/.config/slack-codemode/.env"
chmod 600 "$HOME/.config/slack-codemode/.env"
```

The environment variable wins.

## Authenticate

Script install:

```bash
slack-codemode-auth
```

Manual install:

```bash
node "$INSTALL_DIR/scripts/auth.mjs"
```

Approve the app in the browser and return to the terminal.

To print the authorize URL without starting the browser:

```bash
slack-codemode-auth --dry-run
```

## Verify

Script install:

```bash
slack-codemode-doctor
```

Manual install:

```bash
node "$INSTALL_DIR/scripts/check.mjs"
```

Run this after authentication.

## Register the server

For the script install:

```bash
command -v slack-codemode-mcp
```

For the manual install, use:

```text
node /absolute/path/to/slack-codemode-mcp/mcp/server.mjs
```

Give that path to your MCP client and restart it. The README has client examples.

## Upgrade

Rerun the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/mhmdsami/slack-codemode-mcp/main/install.sh | bash
```

Pin a version:

```bash
curl -fsSL https://raw.githubusercontent.com/mhmdsami/slack-codemode-mcp/main/install.sh \
  | bash -s -- --version <version>
```

Your config and token in `~/.config/slack-codemode` are preserved. Restart the MCP client afterward.

For a manual install, repeat the manual steps with the new version.

## Uninstall

Script install:

```bash
npm uninstall -g --prefix "$HOME/.local" slack-codemode-mcp
rm -f "$HOME/.local/bin/celld"
```

Use the prefix you chose if it was not `~/.local`.

Manual install:

```bash
rm -rf "$HOME/tools/slack-codemode-mcp"
```

The config and token are not removed. To delete them:

```bash
rm -rf "$HOME/.config/slack-codemode"
```

## Troubleshooting

See [Troubleshooting](docs/troubleshooting.md).
