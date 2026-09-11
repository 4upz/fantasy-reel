---
name: web-design-guidelines
description: Review UI for accessibility and interaction issues when asked to audit a page, component, or UI change.
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review the requested UI scope. Infer files from the named page, component, or
current diff; ask for scope only when multiple plausible targets remain.

Use the Web Interface Guidelines at:
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

Fetch them with available web or network tools once per review. If unavailable,
use a previously fetched copy when available and disclose its age, or perform a
limited review of keyboard access, focus, semantics and labels, error feedback,
contrast, reduced motion, and responsive behavior. State that the current upstream
checklist could not be verified; do not block useful review or claim full compliance.

Apply relevant rules to the actual code and the repo's existing design system.
Report actionable findings with severity, clickable file/line references, user
impact, and a suggested correction. Separate observed defects from checks needing
browser verification. Follow the user's requested output format when provided.

A review request authorizes inspection and findings. Make fixes when requested;
keep them scoped to confirmed issues and use the repo's verification workflow.
