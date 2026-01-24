#!/bin/bash
# Check that Supabase is running before tests

# Try to reach the Supabase API
if ! curl -s http://127.0.0.1:54321/rest/v1/ > /dev/null 2>&1; then
  echo ""
  echo "❌ Error: Local Supabase is not running!"
  echo ""
  echo "Please start it first:"
  echo "  npx supabase start"
  echo ""
  exit 1
fi

echo "✓ Supabase is running"
