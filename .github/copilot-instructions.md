# Copilot Instructions — Business Exchange

A B2B integration platform where partners register, subscribe to each other, and exchange messages across formats (JSON, XML, CSV, EDI) with AI-powered schema mapping.

## Commands

```bash
# Install (root)
npm install

# Run all services with hot-reload
npm run dev

# Run a single service (e.g., gateway)
cd apps/gateway && npm run dev

# Build (packages build before apps via Turbo dependency graph)
npm run build

# Lint / typecheck all
npm run lint
npm run typecheck

# Database migrations (from packages/database)
cd packages/database && npm run db:migrate
cd packages/database && npm run db:migrate:down
```

No test files exist yet.

## Architecture

**Turborepo monorepo** with npm workspaces. All packages use the `@bx/` scope.

```
apps/
  gateway/             # Port 3000 — single entry point, JWT auth, rate limiting, reverse proxy
  auth-service/        # Port 3001 — JWT + refresh tokens, bcrypt passwords, API keys
  partner-service/     # Port 3002 — partner registration, profiles, KYB approval flow
  subscription-service/# Port 3003 — partner discovery & subscription management
  integration-service/ # Port 3004 — message routing, webhook delivery, retry logic, format parsers
  mapping-engine/      # Port 3005 — AI schema inference (Azure OpenAI) + JSONata transformations
  agent-orchestrator/  # Port 3006 — autonomous cron agents (monitor, retry, schema-change, alert)
  billing-service/     # Port 3007 — billing
  partner-portal/      # Port 3100 — Next.js 15 + React 19 + Tailwind frontend (src/app router)

packages/
  shared-types/        # All shared TypeScript interfaces and types (Partner, Message, Subscription, etc.)
  shared-utils/        # ID generation (UUID), HMAC webhook signing, API key hashing, backoff, pagination
  database/            # PostgreSQL pool (pg), migrations via node-pg-migrate
  logger/              # Pino logger factory — createLogger(serviceName)
```

**Request flow**: All client traffic enters through the `gateway` on port 3000 (or 11000 in Docker), which reverse-proxies to the appropriate service. JWT is validated at the gateway; downstream services trust the forwarded identity.

**Public routes** (no JWT required):
- `POST /api/partners` root path only (self-registration)
- All `/api/auth` routes (login, register, token refresh)

**AI mapping**: The mapping-engine uses Azure OpenAI (not plain OpenAI) for schema inference. The `openai` npm package is used but configured to point at Azure endpoints via env vars.

**Agent orchestrator**: Uses `node-cron` to schedule 4 agents as classes (`MonitorAgent`, `RetryAgent`, `SchemaChangeAgent`, `AlertAgent`), each with a `.run()` method.

## Key Conventions

**API responses** — every service returns the `ApiResponse<T>` shape from `@bx/shared-types`:
```ts
{ success: boolean; data?: T; error?: string; message?: string }
```
Paginated endpoints return `PaginatedResponse<T>` which extends this with `total`, `page`, `pageSize`.

**Package imports** — always use the workspace alias, never relative cross-package paths:
```ts
import { createLogger } from '@bx/logger';
import { generateId } from '@bx/shared-utils';
import type { Partner, ApiResponse } from '@bx/shared-types';
```

**Service entrypoints** all follow the same pattern: `import 'dotenv/config'` first, then Express setup with `helmet()`, `cors()`, `express.json()`, a `/health` endpoint, routes mounted at their full path prefix, and a global error handler.

**TypeScript** — strict mode, ES2022 target, CommonJS modules, composite + incremental builds. All services extend `tsconfig.base.json`.

**Prettier** — single quotes, semicolons, trailing commas (ES5), print width 100, 2-space indent.

**Database** — PostgreSQL is accessed via `getPool()` from `@bx/database`. Migrations live in `packages/database/migrations/` as numbered SQL files and run automatically on container start (mounted as `docker-entrypoint-initdb.d`).

**Docker ports** — internal service ports (3000–3007) map to external ports 11000–11010. Postgres: 11007→5432, partner-portal: 11009.

**Webhook security** — use `signPayload` / `verifySignature` from `@bx/shared-utils` (HMAC-SHA256) for webhook payloads. API keys are stored as SHA-256 hashes.

**Environment** — copy `.env.example` to `.env`. Azure OpenAI vars (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`) are required for the mapping-engine and agent-orchestrator. All other services only need `DATABASE_URL` and `JWT_SECRET`.

**Partner portal** (Next.js) — uses `src/app` router with route groups. UI components use Radix UI primitives, Tailwind + `clsx`/`tailwind-merge`, forms with `react-hook-form` + `zod` resolvers.
