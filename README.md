# Business Exchange

Business Exchange is a B2B integration platform where partners can register, discover each other, subscribe to data feeds, and exchange business messages across multiple formats such as JSON, XML, CSV, and EDI.

The platform uses an AI-powered mapping engine to normalize partner payloads into a canonical data model (CDM) and reshape them into each receiver's preferred format.

## What this repository contains

This is a Turborepo monorepo with:

- backend microservices under `apps/`
- a Next.js partner/admin portal under `apps/partner-portal`
- shared packages under `packages/`
- local infrastructure and deployment assets under `infra/`

## Table of contents

- [Architecture](#architecture)
- [Core message flow](#core-message-flow)
- [Services and ports](#services-and-ports)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Environment configuration](#environment-configuration)
- [Development workflows](#development-workflows)
- [AI mapping and visibility model](#ai-mapping-and-visibility-model)
- [Deployment](#deployment)
- [Demo mode](#demo-mode)
- [Operational notes](#operational-notes)
- [Troubleshooting](#troubleshooting)

## Architecture

All external traffic enters through the API gateway. The gateway validates JWTs, applies rate limiting, and reverse-proxies requests to downstream services.

```text
Client / Partner Portal
        |
        v
  API Gateway (:3000 / :11000)
        |
        +--> Auth Service
        +--> Partner Service
        +--> Subscription Service
        +--> Integration Service
        +--> Mapping Engine
        +--> Agent Orchestrator
        +--> Billing Service
```

The platform is designed around a few main ideas:

- partners self-register and maintain their own integration settings
- subscriptions define which partners are allowed to exchange messages
- the integration service handles message routing and webhook delivery
- the mapping engine converts partner-specific payloads through an internal CDM
- the agent orchestrator performs retry, monitoring, drift detection, and alerting tasks

## Core message flow

When a partner sends a message, the high-level path is:

1. The sender calls the gateway.
2. The gateway authenticates the request and forwards it to the integration service.
3. The integration service verifies there is an active subscription between sender and receiver.
4. If schemas exist, the mapping engine attempts a two-stage transformation:
   - sender format -> CDM
   - CDM -> receiver format
5. The integration service stores message state and delivers the resulting payload to the receiver webhook.
6. Retry and monitoring agents handle failed webhook delivery attempts later if needed.

### Public routes

These routes do not require JWT authentication:

- `GET /api/partners/platform-branding`
- `POST /api/partners`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/token`

## Services and ports

| Component | Dev Port | Docker Port | Responsibility |
| --- | --- | --- | --- |
| Gateway | `3000` | `11000` | Single entry point, JWT auth, rate limiting, reverse proxy |
| Auth Service | `3001` | `11001` | Login, refresh tokens, OAuth2, API keys |
| Partner Service | `3002` | `11002` | Partner registration, profiles, KYB approval, branding |
| Subscription Service | `3003` | `11003` | Discovery and subscription lifecycle |
| Integration Service | `3004` | `11004` | Message routing, storage, delivery, status tracking |
| Mapping Engine | `3005` | `11005` | AI schema inference and transformation |
| Agent Orchestrator | `3006` | `11006` | Monitor, retry, schema-change, and alert agents |
| Billing Service | `3007` | `11010` | Usage tracking and billing |
| Partner Portal | `3100` | `11009` | Next.js UI for partners and admins |
| PostgreSQL | `5432` | `11007` | Primary database |

## Repository layout

```text
business-exchange/
├── apps/
│   ├── gateway/
│   ├── auth-service/
│   ├── partner-service/
│   ├── subscription-service/
│   ├── integration-service/
│   ├── mapping-engine/
│   ├── agent-orchestrator/
│   ├── billing-service/
│   └── partner-portal/
├── packages/
│   ├── shared-types/
│   ├── shared-utils/
│   ├── database/
│   └── logger/
├── infra/
├── docker-compose.yml
├── turbo.json
└── package.json
```

### Shared packages

- `@bx/shared-types`: shared TypeScript contracts such as `ApiResponse<T>`, `Partner`, `Message`, and subscription models
- `@bx/shared-utils`: IDs, webhook signing, hashing, backoff, and other shared helpers
- `@bx/database`: PostgreSQL connection and migrations
- `@bx/logger`: Pino logger factory

## Getting started

### Prerequisites

- Node.js 20+
- npm 11+
- Docker Desktop for containerized local development
- an AI provider credential set for the mapping engine if you want AI mapping to run

### Quick start with Docker Compose

This is the fastest way to bring the full stack up locally.

```bash
git clone https://github.com/sprintly-exchange/business-exchange.git
cd business-exchange

cp .env.example .env
# edit .env with at least JWT_SECRET, WEBHOOK_SECRET, and your AI provider settings

docker compose up -d --build
```

Then open:

- Partner Portal: `http://localhost:11009`
- Gateway: `http://localhost:11000`

To stop everything:

```bash
docker compose down
```

### Quick start for workspace development

If you want hot reload directly from the monorepo:

```bash
npm install
cp .env.example .env
npm run dev
```

Useful variants:

```bash
npm run build
npm run typecheck
npm run lint

cd apps/gateway && npm run dev
cd apps/partner-portal && npm run dev
cd packages/database && npm run db:migrate
cd packages/database && npm run db:migrate:down
```

### Health checks

Each backend service follows the same service pattern and exposes a `/health` endpoint. The most important local checks are:

- gateway: `http://localhost:11000/health`
- partner portal: `http://localhost:11009`

## Environment configuration

Start from `.env.example`.

### Required for local development

```bash
JWT_SECRET=change-me
WEBHOOK_SECRET=change-me-too
AI_PROVIDER=azure
```

### AI provider options

The mapping engine supports three provider modes.

#### Azure OpenAI

```bash
AI_PROVIDER=azure
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-08-01-preview
```

#### OpenAI

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

#### OpenAI-compatible

```bash
AI_PROVIDER=openai-compatible
OPENAI_API_KEY=...
OPENAI_MODEL=llama-3.1-8b-instant
OPENAI_BASE_URL=https://api.groq.com/openai/v1
```

### Other useful variables

From `.env.example`:

- `CORS_ORIGIN`
- `LOG_LEVEL`
- `RATE_LIMIT_MAX`
- `MAPPING_ENGINE_URL`
- `ENCRYPTION_KEY`

## Development workflows

### Common commands

| Command | What it does |
| --- | --- |
| `npm install` | Install all workspace dependencies |
| `npm run dev` | Run all services with hot reload through Turbo |
| `npm run build` | Build every workspace |
| `npm run typecheck` | Type-check every workspace |
| `npm run lint` | Run lint across workspaces |
| `npm run clean` | Clean workspace artifacts and root `node_modules` |

### Single-service development

Examples:

```bash
cd apps/gateway && npm run dev
cd apps/integration-service && npm run dev
cd apps/partner-portal && npm run dev
```

### Database migrations

The Docker setup mounts `packages/database/migrations` into Postgres initialization. For manual migration work:

```bash
cd packages/database && npm run db:migrate
cd packages/database && npm run db:migrate:down
```

### Current test posture

The monorepo exposes a root `npm run test`, but there are currently no meaningful automated test suites checked in for most services. Right now, `typecheck` is the main repository-wide validation path.

## AI mapping and visibility model

### Canonical Data Model (CDM)

The mapping engine uses an internal CDM as an intermediate representation between sender and receiver formats.

Typical transformation path:

```text
Sender Payload -> CDM -> Receiver Payload
```

### Visibility rules in the integrations UI

The project currently uses viewer-aware payload visibility in the message detail experience:

- sender sees the original raw payload and the CDM
- receiver sees the CDM and the delivered payload in the receiver-facing format
- admin sees all payload variants

This keeps the sender's original raw payload private from receivers while still letting receivers inspect the intermediate normalized representation.

### Mapping fallback behavior

If mapping fails or times out:

- the message can still be delivered successfully
- the UI shows delivery status separately from mapping status
- mapping fallback is surfaced as a warning rather than a delivery failure
- senders can resend the original payload from the message detail UI

## Deployment

### Local Docker Compose

```bash
docker compose up -d
docker compose up -d --build
docker compose logs -f gateway
docker compose logs -f partner-portal
docker compose down
```

### Fly.io

This repository includes Fly.io deployment support and example Fly environment files:

- `.env.fly.example`
- `infra/fly/`
- GitHub Actions workflows for setup and deployment

Typical Fly flow:

1. copy `.env.fly.example` to `.env.fly`
2. fill in Fly and secret values
3. provision via the Fly setup flow
4. deploy from `main`

### Azure Container Apps

Infrastructure templates for Azure live under `infra/bicep/`.

The partner portal needs the gateway URL as a build-time input when deployed externally.

## Demo mode

Demo mode seeds a realistic working environment for demos and manual testing.

### What it gives you

- preconfigured partner companies
- seeded subscriptions
- seeded messages across different industries and formats
- predictable login credentials for demos

### Demo accounts

All demo partners use password `Demo@1234`.

| Company | Email | Focus |
| --- | --- | --- |
| RetailSync Pro | `api@retailsync-demo.io` | Retail |
| GlobalTrade Logistics | `api@globaltrade-demo.io` | Logistics |
| NexusPay Finance | `connect@nexuspay-demo.io` | Payments |
| AgroSupply Chain | `edi@agrosupply-demo.io` | Agriculture |
| MediCore Systems | `integration@medicore-demo.io` | Healthcare |

### Admin account

An admin user is created automatically on first startup.

| Field | Default |
| --- | --- |
| Username | `admin` |
| Password | `admin1234` |

Change the default password before using the platform anywhere beyond local development.

## Operational notes

### Autonomous agents

The agent orchestrator runs four scheduled agents:

| Agent | Responsibility |
| --- | --- |
| Monitor | Detects stuck messages and elevated error rates |
| Retry | Re-attempts failed webhook deliveries |
| Schema Change | Detects payload drift relative to registered schemas |
| Alert | Surfaces dead-letter and schema-drift issues |

### API response shape

Services return shared response types from `@bx/shared-types`.

Standard response shape:

```ts
{ success: boolean; data?: T; error?: string; message?: string }
```

Paginated endpoints extend this with metadata such as `total`, `page`, and `pageSize`.

### Package import convention

Cross-package imports should always use workspace aliases:

```ts
import { createLogger } from '@bx/logger';
import { generateId } from '@bx/shared-utils';
import type { ApiResponse } from '@bx/shared-types';
```

## Troubleshooting

### The portal loads but API calls fail

Check:

- gateway is running on `11000`
- `NEXT_PUBLIC_API_URL` points to the gateway
- your auth token is present and valid

### Docker services start but mapping does not work

Check:

- `AI_PROVIDER` is set correctly
- the corresponding AI provider credentials are present
- `MAPPING_ENGINE_URL` resolves correctly for the environment you are using

### Messages are delivered but mapping shows fallback

That usually means:

- the mapping engine timed out
- no applicable schema was available
- the AI provider or credentials were misconfigured

Delivery status and mapping status are intentionally tracked separately.

### Lint behaves differently than expected

The repository has a root lint command, but parts of the frontend ecosystem may still trigger first-run tooling setup depending on your local environment. If lint prompts for interactive configuration, finish that setup once and rerun the command.

## Suggested first exploration path

If you are new to the codebase, this order works well:

1. read this README
2. start the stack with Docker Compose
3. sign in to the partner portal
4. explore `apps/gateway`, `apps/integration-service`, and `apps/mapping-engine`
5. inspect shared contracts in `packages/shared-types`
6. review seeded/demo flows in the partner portal

## License / usage

No license text is documented in this README. Check repository settings or add a formal license file if this project is intended for broader distribution.
