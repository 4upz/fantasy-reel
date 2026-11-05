#!/bin/bash
# SessionStart hook for Claude Code cloud sessions (see docs/CLOUD-SESSIONS.md).
# Brings up the local Supabase stack and writes the gitignored env files a local
# checkout has. Does nothing outside a cloud session.
#
#   cloud-session-start.sh notice   synchronous: tells Claude the stack is booting
#   cloud-session-start.sh          async: boots it, then reports the outcome

[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0

LOG=/tmp/cloud-session-start.log

if [ "$1" = "notice" ]; then
  echo "Cloud session: the local Supabase stack is starting in the background (log: $LOG)." \
    "A follow-up message reports when it is ready; don't run \`supabase start\` yourself meanwhile." \
    "Claude in Chrome and the browser pane aren't available here: verify UI with headless Playwright" \
    "(\`npm run test:e2e\`, or a script importing chromium from node_modules/@playwright/test)."
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0
# Async hooks deliver only the JSON on stdout; everything else goes to the log.
exec 3>&1 >"$LOG" 2>&1

report() {
  jq -n --arg ctx "$1" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}' >&3
  exit 0
}

fail() {
  report "Cloud session setup failed: $1. Details in $LOG."
}

docker info >/dev/null 2>&1 || dockerd >/tmp/dockerd.log 2>&1 &

# npm writes node_modules/.package-lock.json on install, so this skips a VM
# restored after idle while still reinstalling when the lockfile changed.
if [ ! node_modules/.package-lock.json -nt package-lock.json ]; then
  npm ci --no-audit --no-fund || fail "npm ci failed"
fi

# The lockfile decides the browser revision, as in CI. A no-op once installed.
(cd apps/frontend && npx playwright install chromium) &
playwright=$!

# Edge Functions run inside Docker and never see the session's environment, so
# provider keys set on the cloud environment are copied into their env file. It
# is written before `supabase start`, which is when the Edge Runtime reads it.
{
  echo "TMDB_API_KEY=${TMDB_API_KEY:-cloud-session-placeholder}"
  for key in MDBLIST_API_KEY OMDB_API_KEY; do
    [ -n "${!key}" ] && echo "$key=${!key}"
  done
} >supabase/functions/.env
cp supabase/functions/.env.test.example supabase/functions/.env.test

tries=0
until docker info >/dev/null 2>&1; do
  ((++tries < 30)) || fail "the Docker daemon did not start (see /tmp/dockerd.log)"
  sleep 1
done
npx supabase start || fail "supabase start failed"
STATUS=$(npx supabase status --output env) || fail "supabase status failed"
eval "$STATUS"

cat >apps/frontend/.env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
INBUCKET_URL=$INBUCKET_URL
EOF

# CI's readiness gate: auth, schema, an Edge Function over HTTP, and Realtime.
NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
  node scripts/check-draft-stack.cjs || fail "the stack started but failed its health check"

if [ -n "$TMDB_API_KEY" ]; then
  tmdb="TMDb calls are live"
else
  tmdb="TMDb has a placeholder key, so only cached movies resolve"
fi
browser="Playwright Chromium is installed"
wait "$playwright" || browser="Playwright's Chromium install failed, so E2E can't run until it's fixed"
report "Cloud session: the local Supabase stack is ready (API $API_URL, DB $DB_URL), seeded from supabase/seed.sql. Wrote apps/frontend/.env.local, supabase/functions/.env and supabase/functions/.env.test. $tmdb. $browser."
