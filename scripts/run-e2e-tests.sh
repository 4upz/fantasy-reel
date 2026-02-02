#!/bin/bash
# Run E2E tests with proper Supabase setup
#
# This script handles all the setup required for E2E tests:
# 1. Ensures Supabase is running
# 2. Extracts and exports required environment variables
# 3. Runs Playwright tests
#
# Usage:
#   ./scripts/run-e2e-tests.sh                    # Run all tests
#   ./scripts/run-e2e-tests.sh --ui               # Run with Playwright UI
#   ./scripts/run-e2e-tests.sh --headed           # Run with browser visible
#   ./scripts/run-e2e-tests.sh auth               # Run tests matching "auth"
#   ./scripts/run-e2e-tests.sh --debug login.spec # Debug specific test

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🎬 Fantasy Reel E2E Test Runner${NC}"
echo ""

# Change to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Check if Supabase is running
echo -e "${YELLOW}Checking Supabase status...${NC}"
if ! npx supabase status > /dev/null 2>&1; then
    echo -e "${RED}❌ Supabase is not running.${NC}"
    echo ""
    echo "Please start Supabase first:"
    echo "  npx supabase start"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Supabase is running${NC}"
echo ""

# Extract Supabase keys
echo -e "${YELLOW}Extracting Supabase keys...${NC}"
SUPABASE_STATUS=$(npx supabase status --output json 2>/dev/null)

export SUPABASE_SERVICE_ROLE_KEY=$(echo "$SUPABASE_STATUS" | jq -r '.SERVICE_ROLE_KEY')
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(echo "$SUPABASE_STATUS" | jq -r '.ANON_KEY')
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ "$SUPABASE_SERVICE_ROLE_KEY" = "null" ]; then
    echo -e "${RED}❌ Failed to extract SUPABASE_SERVICE_ROLE_KEY${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Environment configured${NC}"
echo ""

# Run tests
echo -e "${YELLOW}Running E2E tests...${NC}"
echo ""

cd apps/frontend

# Pass through all arguments to playwright
if [ $# -eq 0 ]; then
    # Default: run all tests
    npx playwright test
else
    # Pass arguments through
    npx playwright test "$@"
fi

echo ""
echo -e "${GREEN}✅ E2E tests complete${NC}"
