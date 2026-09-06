#!/bin/bash
# Read-only readiness check shared by local integration/load test commands.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/test-preflight.mjs" "$@"
