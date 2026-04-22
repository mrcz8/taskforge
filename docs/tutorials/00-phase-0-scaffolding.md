# Chapter 00 — Phase 0: The Scaffold

**What this chapter covers:** every piece of the repo that exists at the end of Phase 0 setup — Docker Compose, the backend (Bun + Hono) container, the frontend (Next.js on Node) container, nginx as the single entry point, environment variables, and the TypeScript configuration. By the end of this chapter, nothing in the repo should feel like black magic.

**Where this fits in `task.md`:** Phase 0, "Foundation". Target release v0.0 on 2026-05-04. The gate for Phase 0 is: `curl localhost:8000/api/health` returns 200, and `http://localhost:8000/` renders Next.js.

**What this chapter does NOT cover:** the database layer (Drizzle, migrations, the `users` table) and the CI workflow. Those land in the next chapter.

---

## 1. The big picture: six services behind one door

TaskForge runs as a Docker Compose stack of six services. The shape of the stack is the most important diagram in the project:

```
┌──────────────────────────────────────────────────────────────┐
│                    your browser / curl                       │
│                localhost:8000  (APP_PORT)                    │
└──────────────────────────┬───────────────────────────────────┘
                           │
                      ┌────▼────┐
                      │  nginx  │   single-origin reverse proxy
                      │  :80    │
                      └────┬────┘
               ┌───────────┴──────────┐
               │                      │
         /api/* │                      │ /
               ▼                      ▼
         ┌──────────┐           ┌──────────┐
         │ backend  │           │ frontend │
         │ Bun+Hono │           │ Next.js  │
         │  :3000   │           │  :3000   │
         └────┬─────┘           └──────────┘
              │
       ┌──────┴──────┐
       │             │
       ▼             ▼
 ┌──────────┐   ┌─────────┐      ┌──────────┐
 │ postgres │   │  redis  │◀────▶│  worker  │
 │   :5432  │   │  :6379  │      │ Bun+Hono │
 └──────────┘   └─────────┘      └──────────┘
```

Six services: `nginx`, `backend`, `worker`, `frontend`, `postgres`, `redis`. The user only ever talks to one port — `localhost:8000`. Everything else is private to the Docker network.

### Why this shape

Three design choices worth naming:

1. **One port exposed, not two.** The browser never calls the backend directly. It calls nginx at `:8000`, and nginx decides whether the request is an API call (`/api/*` → backend) or a page load (`/` → frontend). This is the **single-origin** pattern.
2. **The worker is a second backend container.** It runs the same image as `backend`, but instead of serving HTTP it runs `bun run queue:work`. Same code, same deps, different entry point. This will matter once BullMQ workers exist.
3. **Postgres and Redis are not exposed to the host.** There are no `ports:` blocks on them. You can only reach them through another service on the `default` network (which Compose wires up for you automatically). This is a production-style habit; exposing them would work, but it teaches the wrong reflex.

### Why single-origin matters

It's not just tidiness. It's what makes the auth story work later:

- The browser treats `localhost:8000` as one site.
- When login completes, the backend sets an `HttpOnly; Secure; SameSite=Lax` cookie on that origin.
- Every subsequent page load (served by Next.js) and every API call (served by Hono) comes from the **same origin**, so the cookie is automatically attached.
- No CORS configuration, no cross-origin auth token juggling, no `Access-Control-Allow-Credentials`.

If frontend were on `:3000` and backend on `:8000`, you would have to solve CORS and explicitly allow credentials, and the "no auth token in JS" rule in `CLAUDE.md` would be harder to enforce. Single-origin makes the rule free.

---

## 2. The single entry point: `docker-compose.yml`

The entire project starts with one command:

```bash
docker compose up
```

`CLAUDE.md` locks this in: "If a task requires running something outside the compose stack, pause and ask." That rule exists because once you start running pieces on your host, your "works on my machine" story gets weaker. Compose is the contract.

Here is the file broken into chunks.

### 2a. The nginx service

```yaml
nginx:
  image: nginx:1.27-alpine
  ports:
    - "${APP_PORT:-8000}:80"
  volumes:
    - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
  depends_on:
    - backend
    - frontend
  restart: unless-stopped
```

Points worth absorbing:

- **`${APP_PORT:-8000}:80`** — left side is the host port (what you type in a browser), right side is the container port (where nginx actually listens). The `:-8000` is shell-style default-substitution: if `APP_PORT` isn't set in `.env`, use `8000`.
- **`:ro`** on the volume — read-only. The container cannot modify your config file. Small habit, pays off.
- **`depends_on`** only delays startup; it does not wait for the service to be *ready*. For nginx that's fine (it retries upstream connections). For the backend/worker, we use `condition: service_healthy` instead — see §2d.
- **`restart: unless-stopped`** — if the container crashes, Compose restarts it. If **you** `docker compose stop` it, it stays stopped. That's the nice middle-ground policy.

### 2b. The backend service

```yaml
backend:
  build:
    context: ./backend
    dockerfile: Dockerfile
    target: dev
  env_file:
    - .env
  environment:
    DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    REDIS_URL: redis://redis:6379
    NODE_ENV: development
  volumes:
    - ./backend:/usr/src/app
    - backend_node_modules:/usr/src/app/node_modules
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
  command: bun run dev
  restart: unless-stopped
```

The two-level environment resolution is subtle and worth getting right:

1. **`env_file: - .env`** loads every variable from `.env` into the container's environment. So `APP_PORT`, `SESSION_SECRET`, etc., all become available inside the backend process as `process.env.X` (or `Bun.env.X`).
2. **`environment:`** is an **override** block that is evaluated by Compose *before* starting the container. The `${POSTGRES_USER}` references are expanded from `.env` on your host, and the resulting string is injected as `DATABASE_URL`.

Those two things happen at different times. `env_file` is variable *copying*. `environment` with `${...}` is host-side **interpolation**. The reason we do both:

- Most variables are fine to just copy through (`env_file`).
- `DATABASE_URL` needs to be computed from three other variables, so we interpolate it at compose-load time rather than force every developer to keep three places in sync.

**The volumes line is the dev-loop magic:**

- `./backend:/usr/src/app` — bind-mounts your host directory into the container. Edit a file on your host → it appears inside the container immediately → `bun --hot` in `bun run dev` reloads.
- `backend_node_modules:/usr/src/app/node_modules` — a **named volume** *on top of* the bind mount. This is the classic Docker-on-Node pattern. Without it, the bind mount would hide the container's `node_modules` with your (possibly empty or platform-mismatched) host `node_modules`. By layering a named volume at that path, the container keeps its own `node_modules` independent of what's on your host.

> **Node translation:** if you've ever done `nodemon --watch src/ --exec 'node server.js'` inside Docker, you already know this pattern. `bun --hot` replaces `nodemon`, and does it in-process (same PID) rather than by killing and restarting the Node process.

### 2c. The worker service

Identical to `backend` except `command: bun run queue:work`. Same image, same volumes, same env. Two concepts hide here:

1. **One codebase, many process types.** Same Docker image, different entry command. This is how BullMQ will be deployed: the web server and the worker share code but run in separate containers so a slow job cannot starve an HTTP request.
2. **`sleep infinity` for now.** The `queue:work` script in `package.json` is currently `sleep infinity`, a placeholder so the container stays alive and Compose doesn't mark it as failed. We'll replace it when the queue module lands in Phase 6.

### 2d. Postgres and Redis

```yaml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: ${POSTGRES_USER}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: ${POSTGRES_DB}
  volumes:
    - postgres_data:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
    interval: 5s
    timeout: 5s
    retries: 10
  restart: unless-stopped
```

- **The three env vars** are standard for the official Postgres image. Set on first boot, they cause the image's entrypoint to create the database and user. On subsequent boots, they're ignored because the data directory already exists.
- **`postgres_data:` named volume** — this is where your actual database lives. Delete it and your DB is gone. Keep it and `docker compose down && docker compose up` preserves your data.
- **`healthcheck`** — runs `pg_isready` every 5 seconds. The backend and worker both have `depends_on.postgres.condition: service_healthy`, which means Compose won't start them until Postgres's health check passes at least once. This eliminates a whole class of race conditions.

Redis is the same idea with a `redis-cli ping` healthcheck.

### 2e. The volumes block at the bottom

```yaml
volumes:
  postgres_data:
  redis_data:
  backend_node_modules:
  frontend_node_modules:
  frontend_next:
```

Named volumes are just **declared**. Docker creates them on demand and keeps them forever until you `docker compose down -v`. A common footgun: running `docker compose down -v` wipes your dev database. Plain `docker compose down` does not.

---

## 3. The backend: Bun + Hono

### 3a. What Bun is, in one paragraph

Bun is a JavaScript runtime, package manager, bundler, and test runner rolled into one executable, written in Zig. For the purposes of this project it is a drop-in substitute for these Node tools:

| Node tool | Bun equivalent |
|---|---|
| `node` | `bun run` / `bun <file>` |
| `npm` / `pnpm` / `yarn` | `bun install`, `bun add`, `bun remove` |
| `package-lock.json` / `pnpm-lock.yaml` | `bun.lock` (text) or `bun.lockb` (binary) |
| `nodemon` / `tsx --watch` | `bun --hot` |
| `jest` / `vitest` (on backend) | `bun test` |
| `ts-node` / `tsx` | native — Bun runs `.ts` files directly |
| `dotenv` | native — Bun reads `.env` automatically |
| `pg` (Postgres client) | `Bun.sql` (built-in) |
| `fetch` polyfill | native (Bun implements `fetch`, `Request`, `Response` as Web standards) |

The mental-model shift: **many things that were libraries in Node are runtime features in Bun.** That's why dependency lists in Bun projects are short.

### 3b. What Hono is

Hono is a tiny, fast web framework. Think Express, but:

- Built on the Web-standard `Request`/`Response` objects, not Node's `IncomingMessage`/`ServerResponse`.
- Portable across runtimes — the same Hono app runs on Bun, Node, Deno, Cloudflare Workers, Vercel Edge, AWS Lambda@Edge. You change the adapter, not the app.
- No plugin ecosystem the size of Express's, but a compact, well-typed core with middleware for CORS, JWT, validator, logger, etc.

The `CLAUDE.md` rule "Hono's `app.fetch` on `Bun.serve` is the default path" makes sense once you know this: Hono exports an `app.fetch` function of type `(Request) => Promise<Response>`, and `Bun.serve` accepts exactly that shape. The two pieces click together with no glue code.

### 3c. The current `backend/src/server.ts`

```ts
import { Hono } from 'hono';

const app = new Hono();

app.get('/api/health', (c) => {
    return c.json({ ok: true });
});

export default {
    port: 3000,
    fetch: app.fetch,
};
```

Four things to notice:

1. **`export default { port, fetch }`** — this is `Bun.serve`'s configuration object. When Bun executes this file, it sees a default export that looks like a server config and starts an HTTP server automatically. You never had to call `Bun.serve()` yourself; Bun infers it from the shape of the export.
2. **`c` is the Hono context** — a tiny wrapper around the incoming `Request` that exposes `c.json()`, `c.req.*`, `c.header()`, etc. Similar idea to Express's `(req, res) => res.json(...)`, but `req` and `res` are merged into one `c`.
3. **No `bodyParser`** — Hono's context parses JSON on demand via `await c.req.json()`. No middleware required.
4. **The path is `/api/health`, not `/health`.** That's because nginx only forwards `/api/*` to this service. Every backend route will live under `/api/` for the life of the project.

### 3d. The backend Dockerfile, stage by stage

```dockerfile
ARG BUN_VERSION=1

FROM oven/bun:${BUN_VERSION} AS base
WORKDIR /usr/src/app
```

- **`oven/bun`** is the official Bun image, published by Oven, the company behind Bun.
- **`ARG`** lets us bump the Bun version from outside the Dockerfile (`docker build --build-arg BUN_VERSION=1.2`).
- **`WORKDIR`** both creates and `cd`s into `/usr/src/app`. Every later `COPY`, `RUN`, `CMD` is relative to this directory.

```dockerfile
FROM base AS deps
RUN mkdir -p /temp/dev
COPY package.json bun.lock* /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock* /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production
```

This is the **dependency cache stage**. Two reasons to give it its own stage:

- **Docker layer caching.** If `package.json` and `bun.lock` haven't changed, Docker reuses the previous layer and skips the `bun install`. That makes 99% of your rebuilds take seconds, not minutes.
- **Two `node_modules`, one for dev, one for prod.** Production doesn't need `@types/bun`, `drizzle-kit`, test libraries. `--production` drops `devDependencies`. The final image will use the prod copy.

> **The trailing `*` in `bun.lock*`** is a safety net for when the lockfile doesn't exist yet (first build). `COPY` would fail if a named file is missing, but the glob pattern tolerates zero matches.

```dockerfile
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /temp/dev/node_modules node_modules
COPY . .
USER bun
EXPOSE 3000
CMD ["bun", "run", "dev"]
```

The **dev stage**, which is what Compose uses (`target: dev`). It copies the dev `node_modules` from the `deps` stage and the rest of the source, switches to a non-root `bun` user (baked into the `oven/bun` image), and starts the dev server. `EXPOSE 3000` is pure documentation — it does not actually publish a port.

```dockerfile
FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /temp/dev/node_modules node_modules
COPY . .
RUN bun build ./src/server.ts --target bun --outdir ./dist
```

The **build stage** produces the production bundle. `bun build` is Bun's built-in bundler (replaces `esbuild` or `webpack` in the Node world). `--target bun` tells it "emit for the Bun runtime, not the browser, not Node." The output is a single JS file per entry point in `./dist`.

```dockerfile
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /temp/prod/node_modules node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY package.json ./
USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/server.js"]
```

The **runtime stage** is what will ship to production. It contains only the production `node_modules`, the pre-bundled `dist/`, and `package.json`. No source files, no TypeScript, no test files. This is the smallest, fastest image of the four stages.

Worth remembering: **multi-stage builds let you have a fat build toolchain without paying for it at runtime.** A common mistake is to put `bun install` and `bun build` in the same stage as the runtime — your image ends up three times bigger than it needs to be.

### 3e. `backend/package.json` scripts

```json
"dev":       "bun --hot src/server.ts",
"start":     "bun run src/server.ts",
"test":      "bun test",
"typecheck": "tsc --noEmit"
```

- **`bun --hot`** watches for file changes and hot-reloads the server **in the same process**. State (module-level constants, open DB connections) can survive a reload; in Node's `nodemon` world the process restarts entirely. This is one of the clearest "Bun does something Node doesn't" moments.
- **`bun test`** finds any `*.test.ts` file and runs it. The test runner is built into Bun; there is no `jest.config.js` to maintain.
- **`tsc --noEmit`** — we use TypeScript purely as a type checker. Bun itself runs `.ts` directly, so there is no emit step.

### 3f. `backend/tsconfig.json` highlights

The config is the template Bun recommends. The settings that matter most for this project:

```json
"strict": true,
"noUncheckedIndexedAccess": true,
"types": ["bun"],
"module": "Preserve",
"moduleResolution": "bundler",
"allowImportingTsExtensions": true,
"verbatimModuleSyntax": true,
"noEmit": true
```

- **`strict: true`** — turns on every strict-mode check. `CLAUDE.md` bans `any`; this setting is what makes the ban enforceable.
- **`noUncheckedIndexedAccess`** — `arr[0]` has type `T | undefined`, not `T`. You must narrow before use. Prevents a huge class of bugs.
- **`types: ["bun"]`** — pulls in `@types/bun`, which declares globals like `Bun`, `Bun.serve`, `Bun.file`, `Bun.env`, etc. Without this, your editor would underline every `Bun.*` reference in red.
- **`module: "Preserve"` + `moduleResolution: "bundler"`** — tell TypeScript "don't transform imports, don't enforce `.js` extensions, trust the bundler (or Bun) to resolve them." The opposite of the classic `commonjs` / `node` settings.
- **`verbatimModuleSyntax`** — forces you to write `import type { Foo } from './foo'` when you only use `Foo` as a type. Prevents accidental runtime imports of type-only modules, which matters for bundle size and for `tree-shaking`.

---

## 4. The frontend: Next.js 15 on Node 22

### 4a. Why Node for the frontend, when the backend is on Bun

Bun is production-ready for server code, but Next.js's build and runtime rely on several Node-specific internals (mostly around Webpack/Turbopack caches and Node's native module resolution). It *mostly* works under Bun, but "mostly" is not a learning-goal outcome. We keep Next.js on Node 22 (the current LTS) so the frontend never fights the runtime. The `CLAUDE.md` rule says it plainly: "Node 22 only inside the Next.js container."

### 4b. The frontend Dockerfile

Four stages again — same idea as the backend.

```dockerfile
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
```

**`libc6-compat`** is an Alpine-specific package that adds glibc compatibility shims. Some npm packages ship pre-built native binaries compiled against glibc, and Alpine uses musl. Installing this package avoids "cannot find library" errors at runtime.

```dockerfile
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci || npm install
```

**`npm ci || npm install`** — `npm ci` is the strict, reproducible install that requires `package-lock.json` to be present and in sync. If it fails (for example, first build with no lockfile yet), fall back to `npm install`. Belt-and-braces for early development.

```dockerfile
FROM build
RUN npm run build

FROM node:22-alpine AS runtime
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
CMD ["node", "server.js"]
```

Notice the runtime stage copies from `.next/standalone`. That's Next.js's **standalone output mode** — instead of shipping `node_modules` + `.next`, Next emits a self-contained `server.js` with only the deps it actually uses. Your production image ends up a few hundred megabytes smaller.

For standalone mode to work, `next.config.ts` must set `output: 'standalone'`. That's a one-liner to add when we wire it up.

### 4c. Frontend `package.json`

```json
"dev":   "next dev",
"build": "next build",
"start": "next start",
"lint":  "eslint"
```

Standard Next.js scripts. A `test` script is missing — we'll add Vitest and Playwright in their own chapters.

---

## 5. nginx: the single-origin reverse proxy

```nginx
upstream backend_upstream  { server backend:3000;  }
upstream frontend_upstream { server frontend:3000; }

server {
    listen 80;
    server_name _;
    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://backend_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
    }

    location / {
        proxy_pass http://frontend_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Reading this top to bottom:

- **`upstream` blocks** name pools of backend servers. With one server each they look redundant, but they're the right abstraction — add a second instance and you just append it here. `backend:3000` resolves via Docker's internal DNS (every service is reachable by its compose name).
- **`server_name _;`** — underscore is nginx's "catch-all, no virtual host matching" pattern. Fine for a single-site container.
- **`client_max_body_size 10m`** — raises the default (1 MB) to 10 MB so that avatar uploads don't hit the nginx layer's limit before they even reach Hono.
- **Two `location` blocks, ordered specific → general.** `/api/` matches first because it's more specific. The trailing slash on both the match and the `proxy_pass` target matters: it means `/api/health` is forwarded as `/api/health` (not as `/health`).
- **The `X-Forwarded-*` headers** preserve the original client info so the backend can log real IPs and know the scheme the browser used. If you ever need `c.req.header('x-forwarded-for')` to work, this is where it comes from.
- **`Connection "upgrade"` under `/`** — this is what lets Next.js's hot-reload WebSocket survive the proxy. Without it, you'd see HMR fail silently in dev.
- **`Connection ""` under `/api/`** — clears any upgrade header on API requests, since they're plain HTTP.

A subtle correctness point: `location /api/` with the trailing slash only matches requests whose path starts with `/api/`. A request to exactly `/api` (no slash) falls through to `location /`. If you want to be defensive, you can add `location = /api { return 301 /api/; }`, but in practice every client sends the trailing slash or a deeper path.

---

## 6. Environment variables, both files

`.env.example` is committed. `.env` is git-ignored (see `.gitignore`). Both currently hold the same shape:

```
APP_PORT=8000
POSTGRES_USER=taskforge
POSTGRES_PASSWORD=taskforge
POSTGRES_DB=taskforge
DATABASE_URL=postgres://taskforge:taskforge@postgres:5432/taskforge
REDIS_URL=redis://redis:6379
SESSION_SECRET=change-secret
```

Notes you'll need later:

- **`APP_PORT=8000` is the host-facing port.** The whole stack is reached at `http://localhost:8000`, never `8080`.
- **`DATABASE_URL` uses the service name `postgres`, not `localhost`.** Inside the Docker network, `postgres` is the hostname. This is non-negotiable — if you change it to `localhost`, nothing will resolve from inside the backend container.
- **`SESSION_SECRET=change-secret` is a placeholder.** It'll get rotated when Lucia is wired up in Phase 1. For now it just needs to exist so `process.env.SESSION_SECRET` isn't undefined.
- **The `CLAUDE.md` rule** "`.env.example` must always be in sync with required variables" means: every time you add a new env var to the app, you add it to `.env.example` in the same change.

---

## 7. `.gitignore` highlights

Most of it is standard. Three entries deserve a mention:

- **`.bun/`** — Bun's local cache directory, same idea as `.npm/` or `.yarn/`.
- **`next-env.d.ts`** — this is regenerated by Next every time you `next dev`. Committing it means you'd have a noisy diff every time.
- **`CLAUDE.md`** at the bottom — ignored so it never ships with the project. (Opinionated; the user chose to keep their AI-collaboration rules out of the public repo.)

---

## 8. What Phase 0 still needs

Checking the scoreboard against `task.md`'s Phase 0 checklist:

| Item | Status |
|---|---|
| `docker-compose.yml` | on disk |
| `backend/Dockerfile` | on disk |
| `frontend/Dockerfile` | on disk |
| `nginx/default.conf` | on disk |
| `backend/src/server.ts` with `/api/health` | on disk |
| `backend/package.json` scripts | partial — `db:migrate`, `db:seed`, `cli` are placeholders |
| `frontend/package.json` scripts | missing `test` |
| `drizzle.config.ts` pointing at Postgres | **next chapter** |
| First migration creating the `users` table | **next chapter** |
| `.env.example` with every required variable | on disk |
| GitHub Actions workflow | not started |

So at the end of this chapter, the stack boots, the health endpoint responds, and Next.js renders — but there is no database layer yet. That's the next step.

---

## 9. A command cheat-sheet for the Phase 0 stack

All of these run from the project root. The ones prefixed with `docker compose exec` only work once the stack is up.

```bash
# bring everything up in the background
docker compose up -d

# follow logs for a specific service
docker compose logs -f backend

# rebuild after a Dockerfile or lockfile change
docker compose build backend && docker compose up -d backend

# open a shell inside the backend container
docker compose exec backend sh

# inside that shell: run anything with access to the real env and network
bun install
bun run typecheck
bun test

# stop everything (keeps volumes / data)
docker compose down

# stop AND wipe postgres/redis data — destructive
docker compose down -v

# verify the health endpoint
curl -s http://localhost:8000/api/health
# → {"ok":true}

# verify the frontend is reachable through nginx
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/
# → 200
```

If any of those last two return something other than 200, that's the signal to check `docker compose ps` for unhealthy services and `docker compose logs` for the one that's complaining.

---

**End of chapter.** Next chapter picks up at the database: what Drizzle is, how drizzle-kit generates migrations, what Bun's native `Bun.sql` driver does that `pg` doesn't, and the first real migration for the `users` table.
