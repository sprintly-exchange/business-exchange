# Business Exchange — B2B Integration Platform

A self-service B2B integration platform where companies (partners) register, discover each other, subscribe to data feeds, and exchange business messages across formats (JSON, XML, CSV, EDI) — with AI-powered schema inference and auto-mapping to a canonical data model.

---

## Table of Contents

- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Admin Access](#admin-access)
- [Demo Mode](#demo-mode)
- [Key API Flows](#key-api-flows)
- [Project Structure](#project-structure)
- [Autonomous Agents](#autonomous-agents)
- [Development Commands](#development-commands)

---

## Architecture

All traffic enters through a single **API Gateway** (port 3000 / 11000 in Docker) which handles JWT validation and reverse-proxies to the appropriate microservice.

```
Client
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│  API Gateway  :3000                                      │
│  JWT auth · rate limiting · reverse proxy               │
└──┬──────────┬──────────┬──────────┬──────────┬──────────┘
   │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼
Auth      Partner   Subscription Integration  Mapping     Agent
:3001     :3002      :3003        :3004       Engine      Orchestrator
JWT       KYB        Discovery    Routing     :3005       :3006
OAuth2    Approval   & Mgmt       Webhooks    AI Maps     Cron Agents
API Keys  Profiles               Retry       JSONata
```

| Service | Dev Port | Docker Port | Responsibility |
|---|---|---|---|
| API Gateway | 3000 | 11000 | Single entry, auth, rate limiting |
| Auth Service | 3001 | 11001 | JWT, refresh tokens, OAuth2, API keys |
| Partner Service | 3002 | 11002 | Registration, profiles, KYB approval flow |
| Subscription Service | 3003 | 11003 | Partner discovery & subscription management |
| Integration Service | 3004 | 11004 | Message routing, webhook delivery, retry logic |
| Mapping Engine | 3005 | 11005 | AI schema inference (Azure OpenAI) + JSONata transforms |
| Agent Orchestrator | 3006 | 11006 | Autonomous background agents (monitor, retry, alerts) |
| Billing Service | 3007 | 11010 | Usage tracking, plans, invoice generation |
| Partner Portal | 3100 | 11009 | Next.js 15 web UI for partners and admins |
| PostgreSQL | — | 11007 | Primary database |

**Public routes** (no JWT required):
- `POST /api/partners` — partner self-registration
- `POST /api/auth/login` — login
- `POST /api/auth/refresh` — token refresh
- `POST /api/auth/token` — OAuth2 client_credentials

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- An [Azure OpenAI](https://azure.microsoft.com/en-us/products/ai-services/openai-service) resource (for AI schema mapping)

### Option A — Docker (recommended for first run)

```bash
# 1. Clone the repository
git clone <repo-url> && cd business-exchange

# 2. Configure environment
cp .env.example .env
#    Open .env and set:
#      JWT_SECRET        — a long random string
#      WEBHOOK_SECRET    — another long random string
#      ADMIN_PASSWORD    — platform admin password (default: admin1234)
#      AZURE_OPENAI_*    — your Azure OpenAI credentials

# 3. Start everything (DB, all services, portal)
docker compose up -d

# 4. Open the partner portal
open http://localhost:11009
```

The database schema is applied automatically on first startup from  
`packages/database/migrations/001_schema.sql`.

### Option B — Local Dev (hot-reload)

```bash
# 1. Install all dependencies
npm install

# 2. Configure environment (same as above)
cp .env.example .env

# 3. Start PostgreSQL via Docker only
docker compose up -d postgres

# 4. Run all services with hot-reload
npm run dev
```

---

## Admin Access

A **platform admin** user is automatically created on first startup by the auth-service seed script.

| Field | Default |
|---|---|
| Username | `admin` |
| Password | `admin1234` (set `ADMIN_PASSWORD` in `.env` to change) |

Log in at `http://localhost:11009/login` — the portal will redirect admins to `/admin` automatically.

Admin capabilities:
- Approve / reject / suspend partner registrations
- Toggle demo mode (seeds 5 example partners with active subscriptions and messages — see [Demo Mode](#demo-mode))
- Manage platform settings
- View billing plans, usage and invoices

> ⚠️ **Change the default password before deploying to production.**

---

## Demo Mode

Demo Mode instantly populates the platform with **5 pre-configured partner companies**, active subscriptions between them, and seeded messages in multiple formats — so you can explore the full B2B integration flow without registering real partners.

### Activating Demo Mode

1. Sign in as the platform admin at `/login`
2. Go to **Admin → System Settings**
3. Toggle the **Demo Mode** switch — the platform seeds all data in one transaction

Disabling Demo Mode removes all demo partners, subscriptions, and messages cleanly.

---

### Demo Partner Accounts

All demo partners are pre-approved and can log in immediately. They all share the same password:

| Company | Email | Password | Formats | Industry |
|---|---|---|---|---|
| **RetailSync Pro** | `api@retailsync-demo.io` | `Demo@1234` | JSON, CSV, XML | Retail inventory & orders |
| **GlobalTrade Logistics** | `api@globaltrade-demo.io` | `Demo@1234` | JSON, XML, EDI X12 | International freight |
| **NexusPay Finance** | `connect@nexuspay-demo.io` | `Demo@1234` | JSON, CSV | B2B payments & invoicing |
| **AgroSupply Chain** | `edi@agrosupply-demo.io` | `Demo@1234` | EDI X12, EDIFACT, CSV | Agricultural supply chain |
| **MediCore Systems** | `integration@medicore-demo.io` | `Demo@1234` | XML, JSON | Healthcare procurement |

---

### Pre-configured Integration Flows

Five active subscriptions are seeded across the demo partners, each with realistic messages in multiple formats:

```
RetailSync Pro ──────────────────► GlobalTrade Logistics
  3 messages: JSON order, XML shipment, JSON invoice

GlobalTrade Logistics ───────────► NexusPay Finance
  2 messages: JSON payment, CSV remittance

MediCore Systems ────────────────► AgroSupply Chain
  2 messages: EDI X12 purchase order, XML invoice

NexusPay Finance ────────────────► RetailSync Pro
  1 message: JSON invoice

AgroSupply Chain ────────────────► GlobalTrade Logistics
  1 message: EDIFACT shipment notice
```

#### Message formats demonstrated

| Format | Example |
|---|---|
| **JSON** | Orders, payments, invoices |
| **XML** | Shipment notices, healthcare invoices |
| **CSV** | Remittance advice, bulk inventory |
| **EDI X12** | Purchase orders (850 transaction set) |
| **EDIFACT** | Shipment instructions (IFTMIN message) |

#### Message statuses seeded

- `delivered` — successfully processed end-to-end
- `processing` — in-flight (useful for monitoring demo)
- `failed` — triggered retry logic (visible in agent logs)

---

### Demo Walkthrough

A suggested demo script to show the full platform:

1. **Sign in as `api@retailsync-demo.io`** — see the approved partner dashboard
2. **Browse Partners** → discover GlobalTrade Logistics, NexusPay Finance, etc.
3. **View Subscriptions** → active subscription to GlobalTrade is already there
4. **View Messages** → see the 3 pre-seeded messages (delivered, processing, failed)
5. **Settings** → inspect webhook URL and supported message types
6. **Sign out → sign in as `api@globaltrade-demo.io`** — switch perspective to the provider
7. **Sign in as admin** → Admin panel shows all 5 demo partners under "Demo Partners"

---

## Key API Flows

All examples use the gateway base URL `http://localhost:11000`.

### 1. Register as a Partner
```bash
curl -X POST http://localhost:11000/api/partners \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp",
    "domain": "acme.com",
    "contactEmail": "integration@acme.com",
    "password": "securepassword",
    "webhookUrl": "https://acme.com/webhooks/bx",
    "supportedFormats": ["json", "xml"]
  }'
```

### 2. Login
```bash
curl -X POST http://localhost:11000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "integration@acme.com", "password": "securepassword"}'
# → { "data": { "accessToken": "...", "refreshToken": "..." } }
```

### 3. Discover & Subscribe to a Partner
```bash
# List available partners
curl http://localhost:11000/api/subscriptions/discover \
  -H "Authorization: Bearer <token>"

# Subscribe
curl -X POST http://localhost:11000/api/subscriptions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"providerPartnerId": "<partner-uuid>"}'
```

### 4. Register Your Message Schema (AI maps it automatically)
```bash
curl -X POST http://localhost:11000/api/mappings/schemas \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "messageType": "ORDERS",
    "samplePayload": "{\"orderId\":\"ORD-001\",\"total\":99.99,\"currency\":\"USD\"}"
  }'
# → AI infers schema and maps fields to the Canonical Data Model (CDM)
```

### 5. Send a Message
```bash
curl -X POST http://localhost:11000/api/integrations/messages \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "X-Target-Partner-Id: <partner-uuid>" \
  -d '{"orderId": "ORD-001", "total": 99.99}'
# → Mapped to CDM, transformed to target partner format, delivered via webhook
```

---

## Project Structure

```
business-exchange/
├── apps/
│   ├── gateway/              # API Gateway — entry point for all traffic
│   ├── auth-service/         # JWT · refresh tokens · OAuth2 · API keys
│   ├── partner-service/      # Partner registration · KYB · admin routes
│   ├── subscription-service/ # Partner discovery · subscription lifecycle
│   ├── integration-service/  # Message routing · webhook delivery · retry
│   ├── mapping-engine/       # Azure OpenAI schema inference · JSONata transforms
│   ├── agent-orchestrator/   # Cron-based autonomous agents
│   ├── billing-service/      # Plans · usage · invoices
│   └── partner-portal/       # Next.js 15 web UI (React 19 + Tailwind)
├── packages/
│   ├── shared-types/         # All shared TypeScript interfaces (Partner, Message, etc.)
│   ├── shared-utils/         # UUID gen · HMAC signing · API key hashing · backoff
│   ├── database/             # pg pool · ioredis client · schema migration · admin seed
│   └── logger/               # Pino structured logger factory
├── infra/
│   └── k8s/                  # Helm charts
├── docker-compose.yml        # Full-stack local environment
├── turbo.json                # Turborepo task graph
└── package.json              # Workspace root
```

### Shared packages

| Package | Import | Purpose |
|---|---|---|
| `@bx/shared-types` | `import type { Partner } from '@bx/shared-types'` | TypeScript interfaces for all domain objects |
| `@bx/shared-utils` | `import { generateId } from '@bx/shared-utils'` | IDs, HMAC webhook signing, API key hashing, pagination |
| `@bx/database` | `import { getPool } from '@bx/database'` | PostgreSQL pool, admin seed |
| `@bx/logger` | `import { createLogger } from '@bx/logger'` | Pino logger factory |

---

## Autonomous Agents

The **agent-orchestrator** runs four background agents on a schedule:

| Agent | Schedule | What it does |
|---|---|---|
| **Monitor** | Every 1 min | Detects stuck messages, tracks per-partner error rates |
| **Retry** | Every 2 min | Retries failed webhook deliveries (3× with exponential backoff) |
| **Schema Change** | Every 30 min | Detects payload drift against registered schemas, flags for review |
| **Alert** | Every 5 min | Notifies on dead-lettered messages and schema drift events |

Each agent is a TypeScript class with a `.run()` method, scheduled via `node-cron`.

---

## Development Commands

```bash
# Install all workspace dependencies
npm install

# Run all services with hot-reload (requires .env configured)
npm run dev

# Run a single service
cd apps/gateway && npm run dev

# Build everything (packages first, then apps — via Turbo)
npm run build

# Type-check all packages
npm run typecheck

# Lint all packages
npm run lint

# Apply database schema (fresh database)
# → Handled automatically by Docker on first start.
# → For an existing DB, apply manually:
docker exec -i bx-postgres psql -U bx_user -d business_exchange \
  < packages/database/migrations/001_schema.sql
```
# business-exchange
# business-exchange
