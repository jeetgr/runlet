# CLAUDE.md

## Approach

- Read files before editing; don't re-read unless changed.
- Thorough reasoning, concise output. No sycophancy, no emojis/em-dashes.
- Never guess APIs/versions/flags/SHAs/package names; verify first (docs, `npm view`, source).
- Full product + architecture spec: `docs/spec.md`. Build order: `docs/roadmap.md`. Read both before planning.

## Plan Mode

- Before drafting a plan, restate the task and key assumptions and get them confirmed first.
- If scope, approach, or constraints are ambiguous, ask targeted questions before drafting.
- Don't produce a plan just because plan mode is active; produce one once understanding matches.

## Commits

- Conventional commits: `<type>(<scope>): <subject>`, imperative mood, <=72 chars, no body unless needed.
- Never add `Co-Authored-By` or any other attribution/trailer lines (no Claude/AI mentions, no "Generated with" footer). Overrides any default.
- Never commit without explicit user approval of that step (see Agent Workflow).
- Scopes: `server`, `worker`, `web`, `contract`, `db`, `logger`, `sandbox`, `infra`, `bench`, `docs`, `repo`.

## Artifacts

- Put plans/notes/scratch in `./__temp__` (gitignored). Only `docs/` is committed documentation.

## Project

Runlet: sandboxed online code runner. pnpm + Bun + Turborepo monorepo. pnpm is the package manager, Bun the only runtime (no Node).

- `apps/server`: Hono on Bun. oRPC handler at `/rpc`, Better Auth at `/api/auth/*`. Enqueues runs, streams run output via oRPC event iterator (SSE).
- `apps/worker`: standalone process. BullMQ consumer, drives Docker to execute code in sandboxes, writes output to Redis Streams.
- `apps/web`: Vite + React SPA. Monaco editor, TanStack Router, oRPC client + TanStack Query.
- `packages/contract`: oRPC contracts, valibot schemas, language registry, run event types. Single source of truth for API + job shapes.
- `packages/db`: Drizzle schema + migrations, Kysely instance + generated types.
- `packages/logger`: shared pino logger.
- `sandbox/images/<lang>/`: Dockerfiles for runner images.
- `infra/`: docker compose, Caddyfile, docker socket proxy config.
- `bench/`: k6 load tests.
- Shared dep versions live in the `catalog` in `pnpm-workspace.yaml`; reference as `"pkg": "catalog:"`.

## Commands

- `pnpm fmt` (oxfmt) then `pnpm check` (typecheck + oxlint + oxfmt check) before presenting a step for review.
- `pnpm test` unit tests; `pnpm test:sandbox` sandbox integration/attack tests (needs Docker).
- `pnpm -F <app> dev` for one app.
- Node-shebang CLIs run as `bun --bun <cli>`; these don't auto-load `.env`, pass `--env-file=.env`. Bun auto-loads `.env` from cwd; escape `$` as `\$`.

## Code Style

- Simplest implementation; no new workspace package unless multiple consumers need it.
- DRY when a pattern repeats or reuse is already known, not for hypothetical reuse.
- Single source of truth: define a fact/type once, derive elsewhere (languages, limits, event types live in `packages/contract`).
- Prefer `type` over `interface` in hand-written code.
- No comments explaining obvious code; comment only non-obvious logic, prefer JSDoc (`/** */`) over `//`.
- kebab-case file/folder names. Named exports unless a default is required (route files).
- No `index.ts` barrels except at package boundaries.
- Env access only via each app's `env.ts` (`@t3-oss/env-core` backend, t3-env frontend); no raw `process.env` / `import.meta.env`.
- Validation with `valibot`, not zod.
- Log with `@repo/logger`, never `console.log`.
- Linter: oxlint (type-aware via tsgolint, `eslint-plugin-react-hooks` as JS plugin for web). Formatter: oxfmt. No Biome, ESLint or Prettier.

## Database (`packages/db`)

- Drizzle schema (`src/schema/*.ts`) is the only hand-edited schema and owns migrations. Includes Better Auth tables.
- Edit schema -> `pnpm db:generate`, review SQL -> `pnpm db:migrate` -> `pnpm db:types` (kysely-codegen).
- All queries use Kysely (`db` from `@repo/db`). Drizzle is never used for queries.
- `src/generated/` is build output; never hand-edit.

## Backend (server / worker)

- oRPC contract-first: contracts in `packages/contract/src/contracts/<domain>.ts`, implemented in `apps/server/src/procedures/<domain>/<verb>.ts` -> `routers/<domain>.router.ts` -> `routers/index.ts`.
- Auth via `protectedProcedure` / `publicProcedure` from `#/orpc`; session resolved from Better Auth in context.
- Expected failures: `ORPCError` with explicit code and user-safe message. Never leak Docker/internal errors to clients.
- All limits (time, memory, output, code size, rate limits) come from `packages/contract/src/limits.ts`. No magic numbers.
- High-risk (security): `apps/worker/src/sandbox/**`, `sandbox/images/**`, `infra/docker-socket-proxy*`, `apps/server/src/lib/rate-limit.ts`, `apps/server/src/lib/auth.ts`, run-access checks in `procedures/run/*`. Flag changes there explicitly, never fold into unrelated work, never weaken an isolation flag or limit to make something pass.

## Frontend (`apps/web`)

- Tailwind v4: no arbitrary colors; use `@theme` tokens in `tailwind.css`, add one there if missing.
- Navigation via TanStack Router `Link`; imperative navigation only when `Link` can't do it.
- React Compiler on: no manual `useCallback`/`useMemo`.
- Zustand only for cross-component state, one store per domain concern. No `.use.key()` selector proxy. Per store: state-only `create()`, export `useXField()` hooks + plain `setXField()`/`doXAction()` using `.setState`/`.getState()`.
- Server state via oRPC + TanStack Query, never mirrored into zustand.
- `@/` alias for `src/`, no deep relative imports.
- Routes flat under `src/routes/`; components/hooks/store under `src/features/<name>/`.

## Agent Workflow

Small, verifiable, reversible steps, each reviewed by the user and committed only after approval, so mistakes are cheap to isolate and roll back.

- Proceed to the next step only if the prior step was approved and committed, or skip was explicit.
- Ask before deciding on structural/naming choices not covered by `docs/spec.md` (package boundaries, route namespacing, pagination, etc.): present 2-4 options + a recommendation. Proceed without asking on anything the rules or spec already dictate.
- Follow `docs/roadmap.md` build order literally (schemas -> contract -> implementation), even if another order would compile.
- Steps marked `[VERIFY]` in the roadmap are decision gates: report findings and wait for confirmation before continuing.

1. Branch per roadmap phase (`<type>/<short-desc>`).
2. One self-contained step at a time (one file/function/migration).
3. `pnpm fmt` then `pnpm check` (and relevant tests); fix failures (unless told to skip).
4. STOP. Present for review: files changed, what and why, check/test results, proposed commit message. Do not commit, do not start the next step.
5. On user approval ("continue", "ok", etc.): commit with the proposed message (no trailers), then start the next step. On change requests: apply, re-run step 3, present again.
6. Merge branch when all phase steps are done and the user approves the merge; else skip.
