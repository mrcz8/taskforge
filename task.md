# TaskForge Build Plan

A team task management app built to learn Bun. The backend is organized into modules with controllers, policies, validated requests, migrations, and jobs. The frontend is a Next.js SPA that talks to the backend through a typed REST API. The whole stack runs in Docker.

The point of this project is not to ship a product. It is to learn the Bun ecosystem end to end — the runtime, the test runner, the package manager, and the surrounding tooling — by building something non-trivial on top of Hono.

**Plan created:** 2026-04-20
**Target v1.0:** 2026-09-30

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun 1.1 |
| Backend framework | Hono |
| Language | TypeScript (strict) |
| ORM | Drizzle |
| Migrations | drizzle-kit |
| Validation | Zod |
| Auth | Lucia (cookie sessions, HttpOnly) |
| Queue | BullMQ on Redis |
| Database | PostgreSQL 16 |
| Cache / queue / sessions | Redis 7 |
| Frontend | Next.js 15 (App Router) + TypeScript |
| Frontend state | Zustand |
| Frontend styling | Tailwind CSS 4 |
| Web server | nginx 1.27 |
| Local env | Docker Compose |
| Tests | bun test (backend), Vitest + Playwright (frontend) |

---

## Module layout

Each backend module owns its own slice of the app. Inside a module:

| Path | Purpose |
|---|---|
| `backend/src/modules/<module>/controllers` | Thin HTTP handlers |
| `backend/src/modules/<module>/requests` | Zod request schemas |
| `backend/src/modules/<module>/resources` | Response shapers |
| `backend/src/modules/<module>/policies` | Authorization functions |
| `backend/src/modules/<module>/models` | Drizzle model helpers |
| `backend/src/modules/<module>/actions` | Business logic, typed in and out |
| `backend/src/modules/<module>/module.ts` | Module registration entry point |
| `backend/src/modules/<module>/routes.ts` | Route definitions |
| `backend/src/db/migrations` | Schema migrations |
| `backend/src/db/factories` | Test data factories |
| `backend/src/db/seeders` | Dev and demo seeders |
| `backend/src/config/*.ts` | Typed config modules |
| `validate(schema)` middleware | Request body and query validation |
| `can(policy, 'method', resource)` | Authorization check |
| BullMQ workers | Background jobs |
| `bun run cli <command>` | Operational commands |

---

## Repository layout

```
taskforge/
├── docker-compose.yml
├── task.md
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle.config.ts
│   └── src/
│       ├── server.ts
│       ├── app.ts
│       ├── config/
│       ├── db/
│       │   ├── index.ts
│       │   ├── schema.ts
│       │   ├── migrations/
│       │   ├── factories/
│       │   └── seeders/
│       ├── lib/
│       │   ├── validate.ts
│       │   ├── authorize.ts
│       │   ├── resource.ts
│       │   ├── paginate.ts
│       │   └── errors.ts
│       ├── middleware/
│       │   ├── auth.ts
│       │   ├── request-id.ts
│       │   └── rate-limit.ts
│       ├── queue/
│       │   ├── index.ts
│       │   └── workers/
│       ├── cli/
│       │   └── index.ts
│       └── modules/
│           ├── auth/
│           ├── users/
│           ├── workspaces/
│           ├── projects/
│           ├── tasks/
│           ├── comments/
│           └── notifications/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── src/
│       ├── app/
│       │   ├── (auth)/
│       │   ├── (app)/
│       │   └── layout.tsx
│       ├── components/
│       │   ├── ui/
│       │   ├── form/
│       │   └── data/
│       ├── lib/
│       │   ├── api.ts
│       │   └── fetcher.ts
│       ├── stores/
│       ├── modules/
│       │   ├── auth/
│       │   ├── workspaces/
│       │   ├── projects/
│       │   └── tasks/
│       └── types/
└── nginx/
    └── default.conf
```

---

## Module map

Each backend module is self-contained: its own routes, controllers, policies, migrations, tests. Cross-module calls go through events or contracts, never direct imports of another module's internals.

| Module | Purpose | Owns tables |
|---|---|---|
| `auth` | Register, login, logout, password reset, session management | `sessions`, `password_resets` |
| `users` | User profile, avatar, preferences | `users` |
| `workspaces` | Workspace containers, membership, invitations | `workspaces`, `workspace_members`, `invitations` |
| `projects` | Projects inside a workspace, with members and settings | `projects`, `project_members` |
| `tasks` | Tasks with status, priority, assignees, due dates, labels | `tasks`, `task_assignees`, `labels`, `task_labels` |
| `comments` | Polymorphic comments on tasks | `comments` |
| `notifications` | In-app and email notifications with preferences | `notifications`, `notification_preferences` |

---

## Conventions

Binding for every file in the repo.

### Backend

- Every file starts with `import` statements, no top-of-file doc blocks.
- No code comments unless the reason is non-obvious. Names are the documentation.
- Every module exports a `register(app: Hono)` function that mounts routes and wires middleware.
- Controllers stay thin: validate with Zod, delegate to an Action, return a Resource.
- Actions take a typed input, return a typed result, dispatch events. No `Request` or `Response` inside actions.
- Policies are plain functions: `(user, resource) => boolean`.
- Repositories are interfaces first, Drizzle implementations second.
- Errors are typed: `ValidationError`, `NotFoundError`, `ForbiddenError`, `ConflictError`. A global error middleware maps them to JSON envelopes and HTTP codes.
- IDs are ULIDs, stored as `char(26)`. Money is never part of this app, so there are no currency columns to worry about.
- Timestamps are `timestamptz`, stored UTC.
- Every state-changing endpoint has a `bun test` feature test.

### Frontend

- Strict TypeScript. `any` is banned in committed code.
- One component per file, PascalCase filenames.
- Components in `components/ui` are dumb primitives, controlled by props.
- Domain components live inside the relevant module and may read from stores.
- No direct `fetch` calls from components. Go through a module API client in `modules/<feature>/api.ts`.
- No auth token in JS. The session cookie is HttpOnly. The proof of auth is that `GET /api/me` returns 200.
- Tailwind utilities only. No custom CSS classes.

---

## Release plan

Each phase ends with a working slice that runs via `docker compose up`.

| Release | Target | Scope | Gate |
|---|---|---|---|
| v0.0 Foundation | 2026-05-04 | Docker stack, nginx single-origin, Bun server boots, Next.js dev server proxied, CI runs `bun test` | `curl localhost:8080/api/health` returns 200, `localhost:8080/` renders Next.js |
| v0.1 Auth | 2026-05-18 | Register, login, logout, `/api/me`, cookie sessions, rate-limited login, password hashing with Argon2id | A user can sign up through the Next.js UI and stay signed in across refresh |
| v0.2 Users and workspaces | 2026-06-01 | User profile, workspace create, invite by email, workspace switching, policy-gated membership | Two users can share a workspace, a non-member gets 404 on workspace routes |
| v0.3 Projects and tasks (CRUD) | 2026-06-22 | Project CRUD, task CRUD, assignees, labels, list and detail views in the frontend | A user can create a project, add tasks, assign teammates, edit and delete |
| v0.4 Kanban board | 2026-07-13 | Drag and drop between status columns, optimistic updates, server-side reorder, activity log on task | A task moves across columns with no flicker, the order survives a refresh |
| v0.5 Comments and activity feed | 2026-07-27 | Polymorphic comments, @mentions, per-task activity timeline | A user can comment on a task and see an activity trail of edits |
| v0.6 Notifications and queues | 2026-08-17 | BullMQ workers, email on assignment and mention, in-app notification bell, per-user preferences | Assigning a task triggers an email via the queue, worker retries on failure |
| v0.7 Realtime | 2026-09-07 | Server-sent events for task updates in a board, connection survives reconnect | Opening a board in two tabs shows instant updates on both |
| v0.9 Hardening | 2026-09-21 | Rate limiting across routes, CSRF check on mutations, request ID propagation, structured logging, error tracking hook | Abuse signals are visible, request IDs flow end to end |
| v1.0 Release | 2026-09-30 | Optimized Docker build, setup notes, README, seeded demo data | Runs on a fresh machine with one command |

---

## Phase 0 checklist

Do these in order. Do not skip to a later phase until the earlier one is green.

- [ ] `docker-compose.yml` with services: `nginx`, `backend`, `frontend`, `postgres`, `redis`
- [ ] `backend/Dockerfile` using `oven/bun:1.1` base, multi-stage build
- [ ] `frontend/Dockerfile` using `node:22-alpine` for Next.js
- [ ] `nginx/default.conf` proxies `/` to Next.js, `/api/*` to Bun
- [ ] `backend/src/server.ts` with Hono `app.get('/api/health', ...)`
- [ ] `backend/package.json` with `bun test`, `bun run dev`, `bun run db:migrate`, `bun run db:seed`, `bun run cli` scripts
- [ ] `frontend/package.json` with `dev`, `build`, `start`, `test` scripts
- [x] `drizzle.config.ts` pointing at Postgres in-network
- [x] First migration creates `users` table
- [ ] `.env.example` with every required variable
- [ ] A GitHub Actions workflow running `bun test` and `bun run build` on push

---

## Phase 1 checklist

- [ ] `users` table with email (unique), name, password_hash, created_at, updated_at
- [ ] `sessions` table keyed by Lucia
- [ ] `POST /api/register` with Zod body validation, Argon2id hash
- [ ] `POST /api/login` with rate limit (5 / 15 min per IP and per email)
- [ ] `POST /api/logout` clears the session
- [ ] `GET /api/me` returns the current user or 401
- [ ] Auth middleware on every protected route
- [ ] Next.js `(auth)` route group with login and register pages
- [ ] Next.js middleware calls `/api/me` on navigation; redirects to `/login` on 401
- [ ] Zustand `authStore` holds the user object, never a token
- [ ] Feature tests for happy path and all failure modes

---

## Daily cadence

1. Open `task.md`, find the earliest unchecked item in the current phase.
2. Work on that item. Write the test first when the feature is state-changing.
3. Run `bun test` and `docker compose logs -f backend` in split panes.
4. Check the box, commit, move to the next.
5. Do not start a new phase until the current phase is fully checked.

---

## What not to build

The scope creep traps for this project are obvious. Say no.

- No billing. No Stripe. This is not a SaaS.
- No multi-tenant separation beyond workspace membership. One database, one schema.
- No mobile app. The Next.js SPA is the client.
- No microservices. One backend, one frontend, one database.
- No GraphQL. REST only.
- No custom ORM. Drizzle is the ORM.
- No auth vendor. Lucia plus cookies is enough.
- No feature flags, no A/B tests, no analytics beyond simple logs.

---

## Exit criteria

The project is done when a new engineer can clone the repo, run `docker compose up`, sign up, create a workspace, add a project, create a task, assign a teammate, and receive an email about the assignment, all without reading anything beyond the `README.md`.
