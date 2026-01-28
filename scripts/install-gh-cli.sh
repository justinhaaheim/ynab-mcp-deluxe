#!/bin/bash
#
# Install the latest GitHub CLI (gh) from GitHub releases.
# Uses the GitHub API to find the latest release - no hardcoded version.
#
# Usage: ./install-gh-cli.sh [install-dir]
#   install-dir: Where to install gh binary (default: /usr/local/bin)
#
set -e

INSTALL_DIR="${1:-/usr/local/bin}"
REPO="cli/cli"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH_PATTERN="linux_amd64" ;;
  aarch64) ARCH_PATTERN="linux_arm64" ;;
  armv7l)  ARCH_PATTERN="linux_armv6" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

# Check for required tools
if ! command -v curl &> /dev/null; then
  echo "Error: curl is required but not installed" >&2
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed" >&2
  exit 1
fi

# Check if gh is already installed
if command -v gh &> /dev/null; then
  CURRENT_VERSION=$(gh --version | head -1 | awk '{print $3}')
  echo "gh is already installed (version $CURRENT_VERSION)"

  # Check if it's the latest
  LATEST_VERSION=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | jq -r '.tag_name' | sed 's/^v//')

  if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    echo "Already at latest version ($LATEST_VERSION), skipping installation"
    exit 0
  else
    echo "Newer version available: $LATEST_VERSION (current: $CURRENT_VERSION)"
    echo "Upgrading..."
  fi
fi

echo "Fetching latest release info from GitHub API..."

# Get the download URL for the appropriate asset
DOWNLOAD_URL=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" \
  | jq -r ".assets[] | select(.name | test(\"${ARCH_PATTERN}.tar.gz$\")) | .browser_download_url")

if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
  echo "Error: Could not find download URL for ${ARCH_PATTERN}" >&2
  exit 1
fi

VERSION=$(echo "$DOWNLOAD_URL" | grep -oP 'v\d+\.\d+\.\d+' | head -1)
echo "Downloading gh ${VERSION} for ${ARCH_PATTERN}..."

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Download and extract
curl -sL "$DOWNLOAD_URL" | tar xz -C "$TEMP_DIR"

# Find the extracted directory (named like gh_2.86.0_linux_amd64)
EXTRACTED_DIR=$(ls -d "$TEMP_DIR"/gh_* 2>/dev/null | head -1)

if [ -z "$EXTRACTED_DIR" ] || [ ! -d "$EXTRACTED_DIR" ]; then
  echo "Error: Could not find extracted directory" >&2
  exit 1
fi

# Install binary
echo "Installing to ${INSTALL_DIR}/gh..."
if [ -w "$INSTALL_DIR" ]; then
  mv "$EXTRACTED_DIR/bin/gh" "$INSTALL_DIR/gh"
else
  sudo mv "$EXTRACTED_DIR/bin/gh" "$INSTALL_DIR/gh"
fi

# Verify installation
if command -v gh &> /dev/null; then
  echo "Successfully installed: $(gh --version | head -1)"
else
  echo "Installation complete. You may need to add $INSTALL_DIR to your PATH."
fi
