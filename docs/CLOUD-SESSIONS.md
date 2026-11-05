# Claude Code Cloud Sessions

How to give a Claude Code cloud session (claude.ai/code, the desktop app's cloud
option, `claude --cloud`) the same local test stack a laptop has. The model is
the E2E workflow (`.github/workflows/e2e-tests.yml`): it builds the whole stack
on a clean Ubuntu runner with no secrets, and a cloud session is the same kind
of machine (Ubuntu 24.04, ~4 vCPU, 16 GB RAM, Docker available). One difference:
the session uses the lockfile's Supabase CLI via `npx`, as laptops do, where CI
pins its own.

Configuration lives in two places:

| Where | What | Runs |
|---|---|---|
| The cloud environment (claude.ai/code → environment selector → gear icon) | Network allowlist, setup script, optional provider keys | Setup script: once per environment, then cached as a filesystem snapshot (~7 days) |
| This repo: `.claude/settings.json` → [`scripts/cloud-session-start.sh`](../scripts/cloud-session-start.sh) | Starts Supabase, writes the gitignored env files, installs Playwright's Chromium | Every session start and resume; exits immediately outside the cloud |

## Cloud environment settings

These live in the environment dialog, not the repo. Changing the setup script or
the allowed domains rebuilds the cached snapshot.

**Network access:** Custom, with **Also include default list of common package
managers** checked. The defaults already cover npm, jsr.io, Docker Hub,
`public.ecr.aws` (Supabase's images), GitHub, Ubuntu apt and nodejs.org. Add:

```
esm.sh
dl.deno.land
cdn.playwright.dev
playwright.download.prss.microsoft.com
api.themoviedb.org
image.tmdb.org
```

`esm.sh` is required: Edge Functions import from it, so they fail to boot
without it. Add `api.mdblist.com` / `www.omdbapi.com` only if you also add those
keys.

**Setup script** (must finish in under ~5 minutes or nothing is cached; running
processes are never cached, only files):

```
#!/bin/bash
set -euo pipefail
# Deno, pinned to CI's version
curl -fsSL https://dl.deno.land/release/v2.6.4/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip
python3 -m zipfile -e /tmp/deno.zip /usr/local/bin && chmod +x /usr/local/bin/deno
# System libraries Chromium needs; the hook installs the browser itself
npx -y playwright install-deps chromium
```

Bump the Deno version when CI's pin changes. Node is the image's default 22 (CI
pins 24.21.0).

**Environment variables:**

```
BASH_DEFAULT_TIMEOUT_MS=600000
```

`supabase start` and the test suites outlast the 2-minute default command
timeout.

## Provider keys

Testing needs none: CI runs with a placeholder `TMDB_API_KEY`, and the hook does
the same when no key is set. Anyone who uses the environment can read its
environment variables.

| Key | How to provide it |
|---|---|
| `TMDB_API_KEY` (live search/browse) | Environment variable. On Pro/Max plans an **API credential** keeps it out of the session: host `api.themoviedb.org`, header `Authorization`, prefix `Bearer` (`_shared/tmdb.ts` sends it that way). Unverified: whether the proxy covers requests from inside the Edge Runtime container and replaces the placeholder header. |
| `MDBLIST_API_KEY`, `OMDB_API_KEY` | Environment variable only. Both go in a query parameter, which an API credential can't attach. MDBList also has a small daily quota. |
| Resend, Discord, Sentry, Vercel, production Supabase | Leave out. Cloud sessions test against the local stack only. |

A key changed in the dialog reaches an existing session only after its VM
restarts; start a new session to pick it up immediately.

## How the hook runs

The hook runs twice per session start: a synchronous `notice` that tells Claude
the stack is booting (and that browser checks use headless Playwright), and an
async run that does the work without blocking the session. The async run logs
to `/tmp/cloud-session-start.log`, gates on `scripts/check-draft-stack.cjs` like
CI, and reports success or failure to Claude when it finishes. The seeded test
users and local URLs are listed in [supabase/README.md](../supabase/README.md).

## What doesn't carry over

- **Plugins and user-scope MCP servers** (Supabase, Vercel) are enabled in user
  settings, which stay on your machine. Claude can query the local database with
  `psql` instead.
- **Claude in Chrome and the built-in browser pane** are local only.
