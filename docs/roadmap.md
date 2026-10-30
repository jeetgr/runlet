# Runlet Roadmap

Build order. One branch per phase, one commit per step. Each step: implement -> `pnpm fmt` -> `pnpm check` (+ tests named in the step) -> STOP for user review -> commit only after approval (no trailers). `[VERIFY]` steps are decision gates: report findings, wait for confirmation.

## Phase 0: Scaffold (`chore/scaffold`)

1. Root: pnpm workspace, `catalog`, Turborepo, root tsconfig base, `.gitignore` (incl. `__temp__`), scripts `fmt`, `check`, `test`.
2. `[VERIFY]` oxlint + oxfmt setup: type-aware linting (tsgolint) config, `eslint-plugin-react-hooks` via oxlint JS plugins (incl. React Compiler rules), oxfmt Tailwind class sorting. Report what works before configuring.
3. oxlint + oxfmt configs, wire into `fmt` and `check`.
4. `packages/logger`: pino logger export.
5. `infra/compose.dev.yaml`: postgres, redis.
6. `apps/server` skeleton: Hono on Bun, `env.ts`, `/healthz`, logger.
7. `apps/worker` skeleton: `env.ts`, main that logs startup.
8. `apps/web` skeleton: Vite + React + React Compiler + Tailwind v4 + TanStack Router, `env.ts`, empty `/` route.
9. GitHub Actions: install + `pnpm check`.

## Phase 1: Sandbox spike (`feat/sandbox-core`)

1. `[VERIFY]` Docker client on Bun: try dockerode over unix socket and over TCP (socket proxy), and Bun `fetch` with `unix` option against `/version`, create/start/attach/wait/logs. Report what works, recommend one. Output streaming must work.
2. `packages/contract`: `limits.ts`, `languages.ts` (python only for now).
3. `sandbox/images/python/Dockerfile` + `pnpm sandbox:build` script.
4. `worker/sandbox/docker-client.ts`: only needed endpoints.
5. `worker/sandbox/container-spec.ts`: hardened create body from language + limits. Unit test asserting every flag in spec section 5.1.
6. `worker/sandbox/job-dir.ts`: create/cleanup per-job dir with `main.py` + `stdin.txt`.
7. `worker/sandbox/run-in-sandbox.ts`: create -> start -> collect output -> wait with timeout -> inspect -> classify -> remove (always). Returns result; output via callback.
8. Orphan janitor on worker start (remove containers labeled `runlet.job`).
9. Attack test suite (spec 5.5) for python. `pnpm test:sandbox` passes.

## Phase 2: Queue + worker (`feat/run-queue`)

1. `packages/contract`: `job.ts` (queue name, valibot payload), `run-events.ts`.
2. `worker/sandbox/output-sink.ts`: chunking, output cap, XADD + PUBLISH, stream TTL/MAXLEN. Unit test with a real Redis.
3. `worker/process-run.ts` + BullMQ Worker in `main.ts`, concurrency from env, graceful shutdown.
4. Integration test: enqueue job directly, read events from Redis stream, assert result.

## Phase 3: API + streaming (`feat/run-api`)

1. `packages/contract`: `schemas/run.ts`, `contracts/run.ts`, `contracts/language.ts`.
2. `server/orpc.ts`: base, context (identity from IP for now), `publicProcedure`.
3. `server/lib/redis.ts`, `lib/queue.ts`.
4. `server/lib/rate-limit.ts`: per-identity run rate + concurrent-run limit. `[VERIFY]` rate-limiter-flexible on Bun; fall back to small Redis Lua script if not.
5. `procedures/language/list.ts`, router.
6. `procedures/run/create.ts`, router.
7. `server/lib/run-stream.ts`: shared subscriber + fan-out + XRANGE catch-up + dedupe.
8. `procedures/run/events.ts`: owner check, event iterator, `withEventMeta` ids, resume via `lastEventId`.
9. Mount oRPC `RPCHandler` in Hono at `/rpc`.
10. Integration test: create run -> consume events -> result; reconnect mid-stream with lastEventId gets no duplicates/gaps.

## Phase 4: Web editor (`feat/web-editor`)

1. `lib/orpc.ts` client + TanStack Query utils; Vite dev proxy.
2. Theme tokens in `tailwind.css`; app shell layout.
3. `features/editor`: store, Monaco, language picker from `language.list`, starter code.
4. `features/output`: store, consume `run.events`, render stdout/stderr, verdict, timing.
5. Run button + Ctrl/Cmd+Enter, stdin panel, disabled state while running, error toasts for rate limit.

## Phase 5: More languages (`feat/languages`)

1. JavaScript image + registry entry + attack tests.
2. C++ image, compile phase support in `run-in-sandbox`, `compile_error` verdict + tests.
3. Java image + registry entry + tests.

## Phase 6: DB + auth (`feat/auth`)

1. `packages/db`: Drizzle config, `schema/auth.ts` (`[VERIFY]` Better Auth required schema), migration.
2. `packages/db`: Kysely instance, `db:types` via kysely-codegen, export from package.
3. `server/lib/auth.ts`: Better Auth with Kysely adapter, GitHub + Google. `[VERIFY]` adapter wiring.
4. Mount `/api/auth/*` in Hono.
5. Context resolves session; `protectedProcedure`; identity becomes `user:<id>` when logged in.
6. Web: `lib/auth-client.ts`, login/logout buttons, session-aware header.

## Phase 7: User features (`feat/user-features`)

1. Schema: `share`, migration, types. Contracts + procedures `share.create`, `share.get`. Web: Share button, `/s/$shareId` route.
2. Schema: `snippet`, migration, types. Contracts + procedures list/get/create/update/delete/fork.
3. Web: Save, `/snippets`, `/snippets/$id`.
4. Schema: `run_history`. Worker `persist-run.ts` with prune to 50. Contracts + procedures `history.list/get`.
5. Web: `/history`, `/history/$id`.
6. Schema: `user_preference`. Contracts + procedures. Web: `/settings`, localStorage fallback for anon.
7. Repeatable worker job: delete expired anon shares.

## Phase 8: Deploy (`feat/deploy`)

1. Production Dockerfiles for server and worker (Bun base image `[VERIFY tag]`).
2. `infra/compose.yaml` + docker socket proxy (`[VERIFY]` env flags allow only required endpoints) + migration service.
3. `infra/Caddyfile` for `runlet.jeetgr.dev`: TLS, static web, proxy, SSE flush.
4. CI: sandbox tests job on Docker-capable runner.
5. Deploy to VPS: DNS record for `runlet.jeetgr.dev`, prod OAuth apps (GitHub, Google) with prod callback URLs, prod env. Smoke test login + attack suite against prod.

## Phase 9: Performance (`feat/warm-pool`)

1. k6 `bench/run-burst.js`; record baseline numbers to `__temp__/bench-baseline.md`.
2. `[VERIFY]` warm pool file delivery approach (archive into tmpfs vs stdin).
3. `worker/sandbox/pool.ts`: per-language pool, single-use, async refill, behind env flag.
4. Re-benchmark, record numbers.

## Phase 10: gVisor (`feat/gvisor`)

1. `SANDBOX_RUNTIME` env wired into container spec.
2. Install runsc on VPS, run attack suite + benchmarks under runsc, record numbers.

## Phase 11: README (`docs/readme`)

1. Architecture diagram, security model table, attack test results, benchmark table, local setup, demo GIF.
