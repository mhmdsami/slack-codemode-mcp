#!/usr/bin/env bash
set -euo pipefail

REPO="mhmdsami/slack-codemode-mcp"
CELLD_REPO="denoland/celld"
MIN_NODE="20.12.0"
MIN_CELLD="0.6.2"
DEFAULT_CELLD="0.6.3"

VERSION="${INSTALL_VERSION:-}"
CELLD_VERSION="${CELLD_VERSION:-$DEFAULT_CELLD}"
PREFIX="${SLACK_CODEMODE_PREFIX:-}"

usage() {
  cat <<'EOF'
Install Slack Code Mode MCP from a GitHub release.

Usage:
  install.sh [--version <version>] [--prefix <dir>]

Options:
  --version <version>  Release to install, with or without a leading "v".
                       Defaults to the latest GitHub release.
  --prefix <dir>       Install prefix. Defaults to ~/.local.
  -h, --help           Show this help.

Environment:
  INSTALL_VERSION        Same as --version.
  SLACK_CODEMODE_PREFIX  Same as --prefix.
  CELLD_VERSION          celld version to install when needed. Default 0.6.3.

The installer never uses sudo. It preserves ~/.config/slack-codemode.
EOF
}

info() {
  printf '%s\n' "$*"
}

die() {
  printf 'install.sh: error: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

version_ge() {
  node -e '
    const parse = (value) => String(value).replace(/^v/, "").split(".").map((part) => parseInt(part, 10));
    const [a, b, c] = parse(process.argv[1]);
    const [x, y, z] = parse(process.argv[2]);
    const ok = a > x || (a === x && (b > y || (b === y && c >= z)));
    process.exit(ok ? 0 : 1);
  ' "$1" "$2"
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

verify_sums() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c SHA256SUMS
  else
    shasum -a 256 -c SHA256SUMS
  fi
}

latest_version() {
  curl -fsSL --retry 2 --retry-delay 1 \
    "https://api.github.com/repos/$REPO/releases/latest" |
    node -e '
      let input = "";
      process.stdin.on("data", (chunk) => {
        input += chunk;
      });
      process.stdin.on("end", () => {
        const release = JSON.parse(input);
        if (!release.tag_name) process.exit(2);
        process.stdout.write(String(release.tag_name).replace(/^v/, ""));
      });
    '
}

celld_digest() {
  curl -fsSL --retry 2 --retry-delay 1 \
    "https://api.github.com/repos/$CELLD_REPO/releases/tags/v$CELLD_VERSION" |
    node -e '
      let input = "";
      process.stdin.on("data", (chunk) => {
        input += chunk;
      });
      process.stdin.on("end", () => {
        const release = JSON.parse(input);
        const asset = (release.assets || []).find((item) => item.name === process.argv[1]);
        if (!asset || !asset.digest) process.exit(2);
        process.stdout.write(String(asset.digest).replace(/^sha256:/, ""));
      });
    ' "$1"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || die "--version needs a value."
      VERSION="$2"
      shift 2
      ;;
    --prefix)
      [ "$#" -ge 2 ] || die "--prefix needs a value."
      PREFIX="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1. Try --help."
      ;;
  esac
done

[ -n "${HOME:-}" ] || die "HOME is not set."
PREFIX="${PREFIX:-$HOME/.local}"

case "$PREFIX" in
  "~") PREFIX="$HOME" ;;
  "~/"*) PREFIX="$HOME/${PREFIX#\~/}" ;;
esac
case "$PREFIX" in
  /*) ;;
  *) PREFIX="$PWD/$PREFIX" ;;
esac

need uname
need curl
need tar
need gunzip
need mktemp
need node
need npm

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS:$ARCH" in
  Darwin:arm64) CELLD_ASSET="celld-aarch64-apple-darwin.gz" ;;
  Linux:x86_64) CELLD_ASSET="celld-x86_64-unknown-linux-gnu.gz" ;;
  Linux:aarch64 | Linux:arm64) CELLD_ASSET="celld-aarch64-unknown-linux-gnu.gz" ;;
  *)
    die "Unsupported platform: $OS $ARCH. Supported: macOS arm64, Linux x86_64, Linux arm64."
    ;;
esac

NODE_VERSION="$(node -p 'process.versions.node')"
version_ge "$NODE_VERSION" "$MIN_NODE" ||
  die "Node.js $MIN_NODE or newer is required; found $NODE_VERSION."

VERSION="${VERSION#v}"
CELLD_VERSION="${CELLD_VERSION#v}"
case "$VERSION" in
  "") ;;
  *[!0-9A-Za-z._-]*) die "Invalid release version: $VERSION" ;;
esac
case "$CELLD_VERSION" in
  *[!0-9A-Za-z._-]* | "") die "Invalid celld version: $CELLD_VERSION" ;;
esac

if [ -z "$VERSION" ]; then
  info "Resolving the latest release..."
  VERSION="$(latest_version)" ||
    die "Could not resolve the latest release. Pass --version <version> to pin one."
fi
case "$VERSION" in
  *[!0-9A-Za-z._-]* | "") die "Invalid release version: $VERSION" ;;
esac

BIN="$PREFIX/bin"
mkdir -p "$BIN" 2>/dev/null || die "Cannot create $BIN. Choose a writable --prefix."
[ -w "$BIN" ] || die "$BIN is not writable. Choose a writable --prefix."

TMP="$(mktemp -d "${TMPDIR:-/tmp}/slack-codemode-install.XXXXXX")" ||
  die "Could not create a temporary directory."
trap 'rm -rf "$TMP"' EXIT

TARBALL="slack-codemode-mcp-$VERSION.tgz"
RELEASE_URL="https://github.com/$REPO/releases/download/v$VERSION"

info "Downloading $TARBALL..."
curl -fsSL --retry 2 --retry-delay 1 -o "$TMP/$TARBALL" "$RELEASE_URL/$TARBALL" ||
  die "Download failed: $RELEASE_URL/$TARBALL"
curl -fsSL --retry 2 --retry-delay 1 -o "$TMP/SHA256SUMS" "$RELEASE_URL/SHA256SUMS" ||
  die "Download failed: $RELEASE_URL/SHA256SUMS"

info "Verifying the release package..."
(cd "$TMP" && verify_sums) || die "Release package checksum verification failed."

NEED_CELLD=0
HAVE_CELLD=""
if command -v celld >/dev/null 2>&1; then
  HAVE_CELLD="$(celld --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | tail -1 || true)"
fi
if [ -n "$HAVE_CELLD" ] && version_ge "$HAVE_CELLD" "$MIN_CELLD"; then
  info "Using existing celld $HAVE_CELLD."
else
  NEED_CELLD=1
  info "Downloading celld $CELLD_VERSION for $OS $ARCH..."
  DIGEST="$(celld_digest "$CELLD_ASSET")" ||
    die "Could not read the celld release digest. Refusing to install an unverified binary."
  CELLD_URL="https://github.com/$CELLD_REPO/releases/download/v$CELLD_VERSION/$CELLD_ASSET"
  curl -fsSL --retry 2 --retry-delay 1 -o "$TMP/$CELLD_ASSET" "$CELLD_URL" ||
    die "Download failed: $CELLD_URL"
  ACTUAL_DIGEST="$(file_sha256 "$TMP/$CELLD_ASSET")"
  [ "$ACTUAL_DIGEST" = "$DIGEST" ] || die "celld checksum verification failed."
fi

info "Installing slack-codemode-mcp $VERSION into $PREFIX..."
npm install -g --prefix "$PREFIX" "$TMP/$TARBALL" ||
  die "npm install failed."

[ -x "$BIN/slack-codemode-mcp" ] ||
  die "Install did not create $BIN/slack-codemode-mcp."
INSTALLED_VERSION="$("$BIN/slack-codemode-mcp" --version | tr -d '[:space:]')"
[ "$INSTALLED_VERSION" = "$VERSION" ] ||
  die "Installed version $INSTALLED_VERSION does not match $VERSION."

INSTALLED_CELLD=""
if [ "$NEED_CELLD" = "1" ]; then
  gunzip -c "$TMP/$CELLD_ASSET" > "$TMP/celld" || die "Could not unpack celld."
  chmod 0755 "$TMP/celld"
  "$TMP/celld" --version >/dev/null 2>&1 || die "The downloaded celld did not run."
  mv "$TMP/celld" "$BIN/celld"
  INSTALLED_CELLD="$BIN/celld"
fi

info ""
info "Installed slack-codemode-mcp $VERSION"
info "Server: $BIN/slack-codemode-mcp"
if [ -n "$INSTALLED_CELLD" ]; then
  info "celld:  $INSTALLED_CELLD"
else
  info "celld:  $(command -v celld) ($HAVE_CELLD)"
fi
info "Configuration in $HOME/.config/slack-codemode was not changed."

case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    info ""
    info "Add $BIN to PATH, or use the full paths above."
    ;;
esac

if [ -n "$INSTALLED_CELLD" ]; then
  case ":$PATH:" in
    *":$BIN:"*) ;;
    *)
      info "The server finds celld through PATH or SLACK_CODEMODE_CELLD_BIN. Set SLACK_CODEMODE_CELLD_BIN=$INSTALLED_CELLD if needed."
      ;;
  esac
fi

info ""
info "Next steps:"
info "  1. Set SLACK_CLIENT_ID in the environment or in $HOME/.config/slack-codemode/.env"
info "  2. Run $BIN/slack-codemode-auth"
info "  3. Run $BIN/slack-codemode-doctor"
info "  4. Register $BIN/slack-codemode-mcp with your MCP client"
