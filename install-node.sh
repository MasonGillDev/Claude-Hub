#!/usr/bin/env bash
# Installs Node.js 22 LTS (arm64) into ~/.local/node without sudo and
# adds it to your PATH via ~/.zshrc. Safe to re-run.
set -euo pipefail

PREFIX="$HOME/.local/node"

echo "==> Resolving latest Node 22 LTS version..."
VER=$(curl -fsSL https://nodejs.org/dist/index.json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(next(r['version'] for r in d if r['version'].startswith('v22.') and r.get('lts')))")
echo "    Version: $VER"

TARBALL="node-$VER-darwin-arm64.tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

echo "==> Downloading $TARBALL ..."
curl -fsSL -O "https://nodejs.org/dist/$VER/$TARBALL"
curl -fsSL -O "https://nodejs.org/dist/$VER/SHASUMS256.txt"

echo "==> Verifying checksum..."
grep " $TARBALL\$" SHASUMS256.txt | shasum -a 256 -c -

echo "==> Installing to $PREFIX ..."
rm -rf "$PREFIX"
mkdir -p "$PREFIX"
tar -xzf "$TARBALL" -C "$PREFIX" --strip-components=1

# Add to PATH in ~/.zshrc if not already present
MARKER="# >>> node (claude-hub) >>>"
if ! grep -qF "$MARKER" "$HOME/.zshrc" 2>/dev/null; then
  echo "==> Adding Node to PATH in ~/.zshrc ..."
  {
    echo ""
    echo "$MARKER"
    echo 'export PATH="$HOME/.local/node/bin:$PATH"'
    echo "# <<< node (claude-hub) <<<"
  } >> "$HOME/.zshrc"
else
  echo "==> ~/.zshrc already references Node; skipping."
fi

export PATH="$PREFIX/bin:$PATH"
echo ""
echo "==> Done."
echo "    node $($PREFIX/bin/node --version)"
echo "    npm  $($PREFIX/bin/npm --version)"
echo ""
echo "Open a NEW terminal (or run: source ~/.zshrc) so 'node' is on your PATH."
