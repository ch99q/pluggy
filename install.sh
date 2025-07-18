#!/usr/bin/env bash
set -e

REPO="ch99q/pluggy"
BINARY="pluggy"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Map arch if needed
if [ "$ARCH" = "x86_64" ]; then
  ARCH="amd64"
elif [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
fi

URL="https://github.com/$REPO/releases/latest/download/${BINARY}-${OS}-${ARCH}"

curl -fsSL "$URL" -o "$BINARY"
chmod +x "$BINARY"
sudo mv "$BINARY" /usr/local/bin/
echo "$BINARY installed to /usr/local/bin/"
