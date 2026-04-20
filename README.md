# TaskForge

A team task management app built to learn the **Bun** ecosystem end to end runtime, test runner, package manager, and the surrounding tooling by shipping something non-trivial on top of Hono + Next.js.

This is a learning project, not a product. Decisions that favor shipping fast over learning are the wrong trade-off here.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun 1.x |
| Backend framework | Hono |
| ORM | Drizzle (`drizzle-kit` for migrations) |
| Validation | Zod |
| Auth | Lucia (HttpOnly cookie sessions) |
| Queue | BullMQ on Redis |
| Database | PostgreSQL 16 |
| Cache / queue / sessions | Redis 7 |
| Frontend | Next.js 15 (App Router), Tailwind 4, Zustand |
| Web server | nginx 1.27 (single origin, reverse proxy) |
| Local env | Docker Compose |
| Tests | `bun test` (backend), Vitest + Playwright (frontend) |

## Prerequisites

- Docker Desktop (or a recent Docker Engine + Compose v2)
- Make (optional, for shortcuts if added later)

You do **not** need Bun or Node installed on the host, everything runs in containers.

## Getting started

```bash
git clone <repo> taskforge
cd taskforge
cp .env.example .env
docker compose up --build
```

When the stack is up:

- App: http://localhost:8000
- API health check: http://localhost:8000/api/health

Both are served through nginx on the same origin, so the session cookie just works.

## Project layout

```
taskforge/
├── docker-compose.yml
├── task.md              # Build plan, phases, release schedule
├── CLAUDE.md            # Collaboration rules for Claude Code
├── backend/             # Bun + Hono API
│   └── Dockerfile
├── frontend/            # Next.js 15 SPA
│   └── Dockerfile
└── nginx/
    └── default.conf     # Routes / → frontend, /api/* → backend
```

Detailed module layout, conventions, and checklists live in [`task.md`](./task.md).

## Services

`docker compose up` starts:

| Service | Purpose |
|---|---|
| `nginx` | Reverse proxy on port 8000, single origin for frontend + API |
| `backend` | Hono server on Bun |
| `worker` | BullMQ worker process (same image as backend) |
| `frontend` | Next.js dev server |
| `postgres` | PostgreSQL 16 with a healthcheck |
| `redis` | Redis 7 with AOF persistence and a healthcheck |

The backend and worker wait for Postgres and Redis to report healthy before starting.

## Common commands

```bash
# bring the stack up (rebuild images if Dockerfiles changed)
docker compose up --build

# tail backend logs
docker compose logs -f backend

# run backend tests
docker compose exec backend bun test

# run a migration
docker compose exec backend bun run db:migrate

# run a seeder
docker compose exec backend bun run db:seed

# open a shell inside the backend container
docker compose exec backend sh

# shut down and remove volumes (destroys DB data)
docker compose down -v
```

## Phases

Work proceeds in phases defined in [`task.md`](./task.md). Each phase ends with a working slice that runs via `docker compose up`. Do not start phase N+1 until phase N's checklist is fully green.

Current phase targets:

- **v0.0 Foundation** - Docker stack, nginx, Bun server boots, Next.js dev server proxied, CI runs `bun test`
- **v0.1 Auth** - Register / login / logout, `/api/me`, cookie sessions, Argon2id hashing
- **v0.2 Users and workspaces** - Profile, workspace CRUD, invitations, policy-gated membership
- … see `task.md` for the full release table through **v1.0**

## Learning goals

Things this project exists to teach, in rough order:

1. Bun as a runtime (`bun run`, `bun --hot`, `Bun.serve`, `Bun.file`)
2. `bun test` and its watcher / snapshot behavior
3. `bun install`, the text lockfile (`bun.lock`), and workspaces
4. Hono on top of Bun, with typed middleware and routing
5. Drizzle + `drizzle-kit` for schema and migrations
6. Cookie-based auth with Lucia (no JWTs in the browser)
7. Background jobs with BullMQ
8. Multi-stage Docker builds with the official `oven/bun` image
9. Single-origin frontend/backend through nginx
10. End-to-end typed contracts between a TypeScript API and a Next.js client

## What this project is **not**

- Not a SaaS. No billing, no Stripe.
- Not multi-tenant beyond workspace membership.
- Not a microservices demo. One backend, one frontend, one DB.
- Not a GraphQL app. REST only.
- Not a testbed for auth vendors. Lucia + cookies is enough.

Full "what not to build" list is in `task.md`.

## References

- Bun Docker guide - https://bun.sh/guides/ecosystem/docker
- `oven/bun` image - https://hub.docker.com/r/oven/bun
- Hono — https://hono.dev
- Drizzle — https://orm.drizzle.team
- Lucia — https://lucia-auth.com
- BullMQ — https://docs.bullmq.io
- Next.js Docker example — https://github.com/vercel/next.js/tree/canary/examples/with-docker
