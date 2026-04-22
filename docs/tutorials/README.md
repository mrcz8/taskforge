# TaskForge Tutorial Notes

A personal learning archive — not product documentation. These chapters walk through how TaskForge is built, one topic at a time, in the order it was learned. The focus is always **why**, and when something is Bun-specific, how it maps to the Node world you already know.

Chapters are added as the build progresses. The chapter for a step is written **after** that step is finished, so the currently-in-progress work is never in here yet.

## Chapters

- [00 — Phase 0: The scaffold (Docker, Bun, Hono, Next.js, nginx)](00-phase-0-scaffolding.md)
- [01 — Drizzle, the `users` table, and the migration loop](01-drizzle-and-users.md)

## How to use these notes

- Read top to bottom on a quiet afternoon, or dip into a single chapter.
- Every chapter is self-contained: no forward references.
- Code snippets are annotated line by line when the line is doing something non-obvious.
- Where a Bun feature appears, a "Node translation" sidebar explains what it replaces.
- Where a design choice is locked by `task.md` or `CLAUDE.md`, the chapter cites the rule so you know it's not arbitrary.
