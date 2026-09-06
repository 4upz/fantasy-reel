#!/bin/bash
# Run Playwright with fresh local credentials and verified dependencies.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/run-e2e-tests.mjs" "$@"
