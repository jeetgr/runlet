# Runlet Spec

Sandboxed online code runner. Write code in the browser, run it in an isolated container, watch output stream live. Resume project focused on backend/infra depth: isolation, resource limits, queueing, streaming, measured performance.

Items marked `[VERIFY]` are assumptions the agent must confirm against current docs/source before relying on them.

## 1. Product

### 1.1 Modes

| Capability                                                 | Anonymous         | Logged in        |
| ---------------------------------------------------------- | ----------------- | ---------------- |
| Run code (all languages, stdin)                            | Yes               | Yes              |
| Live streamed output                                       | Yes               | Yes              |
| Create share link (read-only snapshot)                     | Yes               | Yes              |
| Open share link, fork into editor                          | Yes               | Yes              |
| Save / rename / delete snippets                            | No                | Yes              |
| Fork snippet into own snippets                             | No                | Yes              |
| Run history (last 50)                                      | No                | Yes              |
| Preferences (default language, font size, theme, vim mode) | localStorage only | Persisted in DB  |
| Rate limit                                                 | Per IP, lower     | Per user, higher |

### 1.2 Out of scope

Interactive terminal/PTY, multi-file projects, package installs, network access from user code, collaborative editing, test-case judging, email/password auth.

### 1.3 Auth

- Better Auth, OAuth only: GitHub + Google.
- DB-backed sessions (cookie). No JWT.
- Anonymous users never get an account row.

## 2. Tech Stack

| Area              | Choice                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo          | pnpm workspaces + Turborepo, pnpm `catalog` for versions                                                                                                                                                   |
| Runtime           | Bun only                                                                                                                                                                                                   |
| HTTP              | Hono on `Bun.serve`                                                                                                                                                                                        |
| API               | oRPC, contract-first (`@orpc/contract`), Hono via fetch `RPCHandler`                                                                                                                                       |
| Validation        | valibot (Standard Schema, accepted by oRPC)                                                                                                                                                                |
| Streaming         | oRPC event iterator (SSE) with `lastEventId` resume                                                                                                                                                        |
| Auth              | Better Auth + `@better-auth/kysely-adapter` `[VERIFY adapter name/usage]`                                                                                                                                  |
| DB                | Postgres                                                                                                                                                                                                   |
| Schema/migrations | Drizzle (drizzle-kit)                                                                                                                                                                                      |
| Queries           | Kysely + kysely-codegen generated types                                                                                                                                                                    |
| Queue             | BullMQ on Redis (BullMQ runs its test suite on Bun in CI)                                                                                                                                                  |
| Redis client      | ioredis (BullMQ default) `[VERIFY single client for BullMQ + streams + pub/sub + rate limit]`                                                                                                              |
| Rate limiting     | `rate-limiter-flexible` with Redis store `[VERIFY Bun compat]`                                                                                                                                             |
| Docker control    | Docker Engine API over unix socket. dockerode on Bun has had socketPath issues; spike decides between dockerode, a Bun-native client, or a thin own client using Bun `fetch` with `unix` option `[VERIFY]` |
| Sandbox           | Docker (runc) with hardened flags; gVisor (`runsc`) as later phase                                                                                                                                         |
| Logger            | pino via `packages/logger`                                                                                                                                                                                 |
| Env               | `@t3-oss/env-core` (backend), t3-env (web)                                                                                                                                                                 |
| Frontend          | Vite + React (React Compiler), TanStack Router, TanStack Query, `@orpc/tanstack-query`, Tailwind v4, Zustand, Monaco (`@monaco-editor/react`)                                                              |
| Lint              | oxlint, type-aware (tsgolint), `eslint-plugin-react-hooks` via JS plugins for web `[VERIFY]`                                                                                                               |
| Format            | oxfmt: import, package.json, Tailwind class sorting `[VERIFY]`                                                                                                                                             |
| Tests             | `bun test`; sandbox attack tests need Docker                                                                                                                                                               |
| Load test         | k6                                                                                                                                                                                                         |
| Deploy            | Single VPS, docker compose, Caddy (TLS + static web + reverse proxy)                                                                                                                                       |
| CI                | GitHub Actions: `pnpm check`, unit tests, sandbox tests on a Docker-capable runner                                                                                                                         |

## 3. Repository Layout

```
apps/
  server/        Hono + oRPC + Better Auth
    src/
      env.ts
      main.ts                 Bun.serve entry
      app.ts                  Hono app: /api/auth/*, /rpc/*, /healthz
      orpc.ts                 base os, context, publicProcedure, protectedProcedure
      lib/auth.ts             Better Auth instance
      lib/redis.ts
      lib/queue.ts            BullMQ Queue (producer)
      lib/rate-limit.ts
      lib/run-stream.ts       Redis Streams catch-up + pub/sub fan-out
      procedures/<domain>/<verb>.ts
      routers/<domain>.router.ts
      routers/index.ts
  worker/
    src/
      env.ts
      main.ts                 BullMQ Worker
      process-run.ts          job handler
      sandbox/
        docker-client.ts      Engine API wrapper (only endpoints we use)
        container-spec.ts     builds hardened create-container body from language + limits
        run-in-sandbox.ts     create -> start -> stream -> wait -> classify -> remove
        output-sink.ts        chunking, output cap, XADD + PUBLISH
        job-dir.ts            per-job host dir lifecycle
        pool.ts               warm pool (later phase)
      persist-run.ts          writes run history for logged-in users
  web/
    src/
      env.ts
      main.tsx
      lib/orpc.ts             client + tanstack query utils
      lib/auth-client.ts      Better Auth react client
      routes/                 flat file routes
      features/editor/
      features/output/
      features/snippets/
      features/history/
      features/settings/
      features/auth/
      tailwind.css
packages/
  contract/
    src/
      index.ts                package boundary barrel
      languages.ts            language registry
      limits.ts               all numeric limits
      schemas/*.ts            valibot schemas
      contracts/<domain>.ts   oRPC contracts
      run-events.ts           stream event schema
      job.ts                  BullMQ job payload schema + queue name
  db/
    drizzle.config.ts
    src/
      index.ts                exports db (Kysely), types
      schema/*.ts             Drizzle tables
      migrations/             drizzle-kit output
      generated/db.d.ts       kysely-codegen output
  logger/
    src/index.ts
  tsconfig/               shared tsconfig presets: base.json, bun.json, react.json
sandbox/
  images/<lang>/Dockerfile
  seccomp.json                optional, later
infra/
  compose.yaml
  compose.dev.yaml            postgres + redis + socket proxy for local dev
  Caddyfile
bench/
  run-burst.js                k6
docs/
  spec.md
  roadmap.md
```

## 4. Architecture

```
Browser (Monaco)
  | oRPC over HTTP (run.create, snippets, ...)
  | oRPC event iterator over SSE (run.events)
  v
Caddy ──> apps/server (Hono + oRPC + Better Auth)
             | BullMQ add             ^ XRANGE catch-up + SUBSCRIBE
             v                        |
           Redis  <──── XADD + PUBLISH ┘
             | BullMQ consume
             v
          apps/worker ──> docker-socket-proxy ──> Docker Engine
                                                     |
                                              per-job container
                                              (no net, ro rootfs, limits)
Postgres <── server (Kysely) / worker (run history)
```

### 4.1 Run lifecycle

1. Client calls `run.create({ language, code, stdin })`.
2. Server: validate (valibot, size limits), resolve identity (`user:<id>` or `ip:<addr>`), check rate limit + concurrent-run limit, generate `runId` (unguessable, e.g. 21-char nanoid `[VERIFY lib]`), store run meta in Redis (`run:<id>:meta` with identity, TTL), enqueue BullMQ job, return `{ runId }`.
3. Client immediately calls `run.events({ runId })` and iterates events.
4. Worker picks job, writes code + stdin to per-job host dir, creates hardened container, starts it, streams stdout/stderr through `output-sink`, waits with wall-clock timeout, classifies result, removes container and job dir, emits final `result` event.
5. If identity is a user, worker inserts run into history (prune to last 50).
6. Server ends the event iterator after `result`.

### 4.2 Output streaming (exactly-once delivery to client)

- Worker, per event: `XADD run:<id>:events * type <t> data <d>` -> gets entry id; then `PUBLISH run:<id> <entryId + event>`.
- Stream key has TTL (e.g. 10 min after result) and `MAXLEN` cap.
- Server `run.events` handler:
  1. Check access: `run:<id>:meta.identity` must equal caller identity, else `NOT_FOUND`.
  2. Subscribe to `run:<id>` (one shared subscriber connection in server, in-process fan-out).
  3. `XRANGE run:<id>:events (<lastEventId or 0> +` to catch up, yield each with `withEventMeta({ id: entryId })`.
  4. Then yield pub/sub events with entryId > last yielded (dedupe by id).
  5. Return after `result` event.
- Reconnect: oRPC passes `lastEventId`; step 3 resumes from there.

### 4.3 Run events (`packages/contract/src/run-events.ts`)

```
status  { state: "queued" | "running" }
stdout  { chunk: string }
stderr  { chunk: string }
result  { verdict, exitCode, durationMs, compileOutput?, truncated }
```

Verdicts: `success`, `runtime_error`, `compile_error`, `timeout`, `memory_limit`, `output_limit`, `internal_error`.

## 5. Sandbox

### 5.1 Container settings (per job, single-use)

| Setting             | Value                                                           | Defends against                            |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| Network             | `none`                                                          | exfiltration, attacks on internal services |
| Rootfs              | read-only                                                       | tampering with image                       |
| `/src`              | per-job host dir, bind mount, read-only                         | code + stdin input                         |
| `/workspace`        | tmpfs, size cap (e.g. 64 MB), exec allowed (compiled langs)     | build output                               |
| `/tmp`              | tmpfs, size cap, noexec                                         | scratch                                    |
| User                | `65534:65534` (nobody)                                          | root in container                          |
| Capabilities        | drop ALL                                                        | privilege ops                              |
| `no-new-privileges` | on                                                              | setuid escalation                          |
| Memory              | limit = swap limit (no swap), default 256 MB                    | memory bombs                               |
| CPU                 | NanoCpus 0.5 CPU                                                | CPU hogging                                |
| PIDs                | limit 64                                                        | fork bombs                                 |
| ulimits             | nofile, fsize capped                                            | fd/file exhaustion                         |
| Wall-clock timeout  | run 5 s, compile 10 s; worker kills container                   | infinite loops, sleep                      |
| Output cap          | 64 KB combined stdout+stderr; then kill, verdict `output_limit` | log floods                                 |
| Auto-remove         | worker always removes in `finally`                              | leaked containers                          |
| Labels              | `runlet.job=<id>`                                               | janitor cleanup of orphans on worker start |

Exact Engine API field names (`HostConfig.NetworkMode`, `ReadonlyRootfs`, `Tmpfs`, `PidsLimit`, `NanoCpus`, `Memory`, `MemorySwap`, `CapDrop`, `SecurityOpt`, `Ulimits`) `[VERIFY against Engine API docs for the installed Docker version]`.

Result classification: OOM via container inspect `State.OOMKilled`; timeout via worker timer; output cap via sink; compile error via compile step exit code; non-zero exit -> `runtime_error`.

### 5.2 Language registry (`packages/contract/src/languages.ts`)

Single source of truth used by web (picker, Monaco language id, starter code), server (validation), worker (image, commands).

| id           | Image                         | Compile                                    | Run                                         |
| ------------ | ----------------------------- | ------------------------------------------ | ------------------------------------------- |
| `python`     | `runlet/python`               | none                                       | `python3 /src/main.py < /src/stdin.txt`     |
| `javascript` | `runlet/node` or `runlet/bun` | none                                       | run `/src/main.js`                          |
| `cpp`        | `runlet/cpp` (gcc)            | `g++ -O2 -o /workspace/main /src/main.cpp` | `/workspace/main < /src/stdin.txt`          |
| `java`       | `runlet/java`                 | `javac -d /workspace /src/Main.java`       | `java -cp /workspace Main < /src/stdin.txt` |

Images: built from `sandbox/images/<lang>/Dockerfile` on top of official slim images, pinned by digest `[VERIFY tags/digests]`, nonroot user, no package manager caches. Run command executed via `sh -c` inside container; compile and run are separate phases with separate timeouts (same container).

### 5.3 Docker access

- Worker never mounts the raw Docker socket. It talks to a docker socket proxy (e.g. `tecnativa/docker-socket-proxy` `[VERIFY image + env flags]`) exposing only containers create/start/wait/logs/attach/inspect/kill/delete and images inspect.
- Job dir path must be a host path visible to Docker (bind source). Configure `JOB_DIR_HOST` and `JOB_DIR_LOCAL` env (same path if worker runs on host).

### 5.4 Later phases

- Warm pool: per language keep N pre-created, started idle containers. Job: copy files into tmpfs via archive upload `[VERIFY archive into tmpfs works]` or use pre-attached stdin, exec run, then destroy. Containers are never reused across jobs. Refill async. Measure p50/p95 before/after.
- gVisor: `SANDBOX_RUNTIME=runc|runsc` env; install runsc on VPS; rerun attack tests + benchmarks under both.

### 5.5 Attack test suite (`apps/worker/test/sandbox/*.test.ts`)

Each asserts verdict and that host is unaffected:

- infinite loop -> `timeout`
- fork bomb -> contained (pids limit), worker remains healthy
- allocate 2 GB -> `memory_limit`
- network request (python socket to 1.1.1.1) -> fails
- write to `/` and `/src` -> fails (read-only)
- print forever -> `output_limit`
- write huge file to `/tmp` -> tmpfs cap
- read `/etc/shadow`, `id` -> nobody, no access
- sleep 60 -> `timeout`
- 20 parallel jobs -> all complete, no leaked containers (label query empty after)

## 6. Limits (`packages/contract/src/limits.ts`)

| Limit                    | Value                                         |
| ------------------------ | --------------------------------------------- |
| Max code size            | 64 KB                                         |
| Max stdin size           | 64 KB                                         |
| Run timeout              | 5 s                                           |
| Compile timeout          | 10 s                                          |
| Memory                   | 256 MB                                        |
| CPU                      | 0.5                                           |
| PIDs                     | 64                                            |
| Output cap               | 64 KB                                         |
| Anonymous runs           | 10 / min / IP                                 |
| User runs                | 30 / min / user                               |
| Concurrent runs          | anon 1, user 2                                |
| Anonymous share creation | 5 / hour / IP                                 |
| Snippets per user        | 200                                           |
| Run history kept         | 50 per user                                   |
| Anonymous share TTL      | 30 days                                       |
| Queue job TTL            | 60 s waiting, then fail `internal_error`      |
| Worker concurrency       | env `WORKER_CONCURRENCY`, default = CPU cores |

Client IP: from Caddy `X-Forwarded-For`, trusted only from the proxy. Use Hono's `getConnInfo` for Bun `[VERIFY]` plus header parsing in one helper.

## 7. Data Model (Drizzle, Postgres)

Better Auth tables (`user`, `session`, `account`, `verification`) defined in Drizzle to match Better Auth's required schema. Generate reference via Better Auth CLI `[VERIFY command + output for kysely/drizzle]`, then own it in `schema/auth.ts`.

```
snippet
  id            text pk (nanoid)
  user_id       text fk user.id on delete cascade, index
  title         text not null
  language      text not null
  code          text not null
  stdin         text not null default ''
  forked_from   text null (snippet.id or share.id, no fk)
  created_at    timestamptz default now()
  updated_at    timestamptz default now()

share
  id            text pk (short slug)
  user_id       text null fk user.id on delete set null
  language      text not null
  code          text not null
  stdin         text not null default ''
  created_at    timestamptz default now()
  expires_at    timestamptz null (anon only)

run_history
  id            text pk (= runId)
  user_id       text fk user.id on delete cascade
  language      text not null
  code          text not null
  stdin         text not null
  verdict       text not null
  exit_code     int null
  stdout        text not null (truncated)
  stderr        text not null (truncated)
  duration_ms   int not null
  created_at    timestamptz default now()
  index (user_id, created_at desc)

user_preference
  user_id         text pk fk user.id on delete cascade
  default_language text not null
  font_size       int not null
  theme           text not null ('light' | 'dark' | 'system')
  vim_mode        boolean not null default false
  updated_at      timestamptz default now()
```

Expired anonymous shares: deleted lazily on read and by a periodic worker job (BullMQ repeatable job).

## 8. API (oRPC contracts)

Context: `{ session: Session | null, identity: "user:<id>" | "ip:<addr>", ip }`.

| Procedure           | Auth               | Input                                            | Output                            |
| ------------------- | ------------------ | ------------------------------------------------ | --------------------------------- |
| `language.list`     | public             | none                                             | language registry (public fields) |
| `run.create`        | public             | `{ language, code, stdin }`                      | `{ runId }`                       |
| `run.events`        | public, owner-only | `{ runId }`                                      | event iterator of run events      |
| `share.create`      | public             | `{ language, code, stdin }`                      | `{ shareId }`                     |
| `share.get`         | public             | `{ shareId }`                                    | share                             |
| `snippet.list`      | protected          | `{ cursor?, limit }`                             | `{ items, nextCursor }`           |
| `snippet.get`       | protected, owner   | `{ id }`                                         | snippet                           |
| `snippet.create`    | protected          | `{ title, language, code, stdin }`               | snippet                           |
| `snippet.update`    | protected, owner   | `{ id, ...partial }`                             | snippet                           |
| `snippet.delete`    | protected, owner   | `{ id }`                                         | `{ ok }`                          |
| `snippet.fork`      | protected          | `{ source: { type: "snippet" \| "share", id } }` | snippet                           |
| `history.list`      | protected          | `{ cursor?, limit }`                             | `{ items, nextCursor }`           |
| `history.get`       | protected, owner   | `{ id }`                                         | run_history row                   |
| `preference.get`    | protected          | none                                             | preferences (defaults if none)    |
| `preference.update` | protected          | partial                                          | preferences                       |

- Pagination: cursor = `created_at` + `id` keyset.
- Errors: `BAD_REQUEST` (validation), `UNAUTHORIZED`, `NOT_FOUND` (also for not-owner, to avoid leaking existence), `TOO_MANY_REQUESTS` (with retry-after in data), `INTERNAL_SERVER_ERROR` (generic message).
- Hono routes: `/api/auth/*` (Better Auth), `/rpc/*` (oRPC `RPCHandler`), `/healthz`.
- CORS: not needed in prod (same origin via Caddy). Dev: Vite proxy `/rpc` and `/api` to server.

## 9. Frontend

Routes:

| Path            | Screen                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`             | Editor: language picker, Monaco, stdin panel, Run button, output panel (stdout/stderr interleaved, verdict, time), Share button, Save (logged in) |
| `/s/$shareId`   | Read-only view of share, "Open in editor" (copies into editor state) and "Fork" (logged in)                                                       |
| `/snippets`     | List, rename, delete (auth)                                                                                                                       |
| `/snippets/$id` | Editor bound to snippet, autosave or explicit save                                                                                                |
| `/history`      | Run history list, open detail (auth)                                                                                                              |
| `/history/$id`  | Past run code + output, "Open in editor"                                                                                                          |
| `/settings`     | Preferences (auth; anon uses localStorage)                                                                                                        |

- Editor draft (code, stdin, language) per tab in zustand store `features/editor/store.ts`, persisted to localStorage.
- Output stream consumed with `consumeEventIterator`, appended to output store; cancel on unmount/new run.
- Keyboard: Ctrl/Cmd+Enter runs.
- Login: GitHub/Google buttons in header via Better Auth client.

## 10. Environment Variables

server: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WEB_ORIGIN`, `PORT`, `TRUST_PROXY`.

worker: `DATABASE_URL`, `REDIS_URL`, `DOCKER_HOST` (socket proxy URL), `JOB_DIR_HOST`, `JOB_DIR_LOCAL`, `WORKER_CONCURRENCY`, `SANDBOX_RUNTIME`.

web: `VITE_API_URL` (empty in prod, same origin).

## 11. Deployment

- Domain: `https://runlet.jeetgr.dev` (single origin: web, `/rpc`, `/api/auth`). DNS A/AAAA record for `runlet` -> VPS IP. `.dev` is HSTS-preloaded, so HTTPS only; Caddy auto-provisions the cert.
- Prod env: `BETTER_AUTH_URL=https://runlet.jeetgr.dev`, `WEB_ORIGIN=https://runlet.jeetgr.dev`, `VITE_API_URL` empty.
- OAuth redirect URIs to register: `https://runlet.jeetgr.dev/api/auth/callback/github` and `.../callback/google`, plus `http://localhost:<web port>/api/auth/callback/<provider>` for dev (separate dev OAuth apps recommended) `[VERIFY callback path against Better Auth docs]`.
- Session cookie scoped to `runlet.jeetgr.dev` only (no parent-domain cookie), `Secure`, `SameSite=Lax`.
- VPS (Linux, Docker installed). `infra/compose.yaml`: caddy, server, worker, postgres, redis, docker-socket-proxy. Runner images built on the VPS (`pnpm sandbox:build`).
- Caddy: TLS, serves `apps/web/dist`, proxies `/rpc/*`, `/api/*` to server. SSE needs no buffering `[VERIFY Caddy flush settings for SSE]`.
- Migrations run as a one-off compose service before server starts.
- Backups: nightly `pg_dump` (optional).

## 12. Observability

- pino JSON logs, with `runId` on every worker log line.
- Per run: queue wait ms, container create ms, run ms, total ms logged. Used for benchmark numbers.
- `/healthz` on server; worker health via BullMQ worker events + log.

## 13. Benchmarks (README numbers)

- k6 `bench/run-burst.js`: N virtual users running a Python hello world, and a CPU-bound script.
- Report: throughput (runs/s), p50/p95/p99 end-to-end latency, cold (no pool) vs warm pool, runc vs runsc.
- Record machine specs alongside numbers.

## 14. README deliverables

Architecture diagram, security model table (section 5.1), attack test results, benchmark table, demo GIF, local setup steps.
