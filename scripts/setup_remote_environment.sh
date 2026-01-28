#!/bin/bash

# Example: Only run in remote environments
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

bun i

# Install beads
curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash

# Install GitHub CLI (only if GH_TOKEN is set)
if [ -n "$GH_TOKEN" ]; then
  "$(dirname "$0")/install-gh-cli.sh"
else
  echo "Skipping GitHub CLI installation (GH_TOKEN not set)"
fi

exit 0