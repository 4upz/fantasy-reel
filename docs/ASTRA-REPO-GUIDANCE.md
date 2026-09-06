# Astra repository instruction audit

Applied September 6, 2026 UTC, using the official
[GPT-6 Astra migration and prompting guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra#gpt-6-astra-migrate-with-codex).

## Scope

This change tunes Codex's repository instructions. The inspected workspace package
manifests contain no OpenAI SDK dependency, and no repo-local `.codex` configuration
was present. No API migration or model/reasoning setting change was needed for this
instruction audit. User-level Codex settings and installed plugin files were not
modified.

The official guide recommends auditing instruction conflicts, making autonomy and
delegation expectations explicit, using concise communication, and sizing checks
to the change. These recommendations are applied in `AGENTS.md` with project-specific
constraints. They are expected improvements, not measured model-performance results.

## Findings and changes

| Previous instruction surface | Change |
| --- | --- |
| 48,082-byte root guide, almost identical to `CLAUDE.md` | Shorter Codex entry point; detailed domain material remains in `CLAUDE.md` for selective reading. |
| Mandatory Claude-specific Task, browser, and simplifier names | Use available equivalents; preserve simplification before verification and disclose actual gaps. |
| Browser verification after every implementation step | Verification matrix distinguishes documentation, backend, UI, tests, and build changes. |
| Missing seeded accounts prompted `db reset`, while another section prohibited casual resets | Explicitly preserve data; use fixtures or create test users. Destructive resets require authorization. |
| “All changed files” staging could include another task's work | Inspect all changes, stage all task-related files explicitly, preserve unrelated edits. |
| Team templates and duplicated process text | Bounded delegation criteria, ownership/contracts, lead-owned integration and commits. |
| No explicit handling of skill-induced pauses | Check applicability and existing authorization; explain the exact instruction if a blocker remains. |
| Stale file tree placed shared components/hooks under `app/` | Corrected to the directories present in the checkout. |
| Static debt lists and outdated test examples in startup context | Consult current scripts and relevant test documentation when needed. |

Core roster, bidding, trading, counterpick, scoring, RLS, deployment, design, and
observability constraints remain in the entry point. The detailed domain sections
are still available in the unchanged `CLAUDE.md`.

## Skill interaction findings

The OpenAI Docs skill supplied the migration workflow. The installed
`superpowers:using-superpowers` instructions and its Codex adapter were also read.
Their broad skill-loading trigger and adapter-specific tool/model assumptions can
conflict with the current harness. Follow the actual tool schema and higher-priority
session instructions; do not copy old adapter configuration examples automatically.

The local Superdesign skill's mandatory initialization/context/CLI requirements
were inspected as a potential source of extra UI setup. They apply when that design
workflow is relevant, not to this documentation edit. No installed or vendored skill
was rewritten. This was a targeted audit, not a full audit of every installed plugin.

## Validation and follow-up evaluation

For this documentation-only change, validate whitespace, reference paths, retained
project invariants, and conflicting instructions after simplification. Application
tests do not establish whether an instruction rewrite improves agent behavior.

For a behavioral comparison, run the same representative tasks from identical
clean starting states with the previous and revised guides, holding Astra's model,
reasoning effort, tools, and environment constant:

1. A small documentation fix: inspect scope, unnecessary approval questions, and
   whether unrelated builds/browser tests are avoided.
2. A UI bug fix: inspect component reuse, simplification before browser checks,
   and evidence for affected desktop/mobile behavior.
3. A backend change involving RLS or transactions: inspect domain invariants and
   meaningful integration verification.
4. A multi-subsystem feature: inspect bounded parallel ownership, contracts, and
   final integration quality.

Record correctness, wall time, token usage, tool calls, approval pauses, repeated
checks, and unrelated edits. Repeat comparisons before attributing differences to
the guide. No controlled before/after runs were performed as part of this change.

## Follow-up skill cleanup — September 6, 2026

At the user's request, redundant skills were removed and useful guidance retained:

- Uninstalled `superpowers@claude-plugins-official`. The repo workflow and Codex
  harness already cover planning, debugging, delegation, and verification without
  the plugin's mandatory approval gates.
- Removed the repo-local Superdesign skill and its supporting prompts. The retained
  frontend-design plugin and Cinematic Dark conventions cover this app's UI work.
- Removed the repo-local React skill and its compiled manual/rules. All 57 local
  rule filenames exist in the installed Vercel plugin, which supplies React guidance.
- Uninstalled `supabase@claude-plugins-official`, retaining the connected
  `supabase@openai-curated-remote` plugin. Both manifests referenced the same app;
  the canonical connected plugin remains the source of Supabase tools and skills.
- Uninstalled `postgres-best-practices@supabase-agent-skills`. Its 34 SQL reference
  files were byte-identical to those in the retained Supabase plugin.
- Kept the local accessibility review skill, replacing mandatory scope questions
  and a hardcoded fetch tool with inferred scope, available tooling, and a disclosed
  limited-review fallback. Findings distinguish code evidence from unverified UI
  behavior. Reviews do not silently turn into implementation tasks.

Plugin removals affect this Codex installation beyond the repo. Repository changes
are versioned; installed plugin caches were not hand-edited. Previously loaded
instructions may remain in an existing conversation's context.
