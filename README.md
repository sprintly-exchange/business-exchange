# Business Exchange — B2B Integration Platform

A self-service B2B integration platform where companies (partners) register, discover each other, subscribe to data feeds, and exchange business messages across formats (JSON, XML, CSV, EDI) — with AI-powered schema inference and auto-mapping to a canonical data model.

---

## Table of Contents

- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
  - [Local — Docker Compose](#local--docker-compose)
  - [Fly.io (Recommended Cloud)](#flyio-recommended-cloud)
  - [Azure Container Apps](#azure-container-apps)
- [White-Label Branding](#white-label-branding)
- [AI Provider Configuration](#ai-provider-configuration)
- [Admin Access](#admin-access)
- [Demo Mode](#demo-mode)
- [Key API Flows](#key-api-flows)
- [Project Structure](#project-structure)
- [Autonomous Agents](#autonomous-agents)
- [Development Commands](#development-commands)

---

## Architecture

All traffic enters through a single **API Gateway** which handles JWT validation and reverse-proxies to the appropriate microservice.

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
| Partner Service | 3002 | 11002 | Registration, profiles, KYB approval, branding |
| Subscription Service | 3003 | 11003 | Partner discovery & subscription management |
| Integration Service | 3004 | 11004 | Message routing, webhook delivery, retry logic |
| Mapping Engine | 3005 | 11005 | AI schema inference + JSONata transforms |
| Agent Orchestrator | 3006 | 11006 | Autonomous background agents (monitor, retry, alerts) |
| Billing Service | 3007 | 11010 | Usage tracking, plans, invoice generation |
| Partner Portal | 3100 | 11009 | Next.js 15 web UI for partners and admins |
| PostgreSQL | — | 11007 | Primary database |

**Public routes** (no JWT required):
- `GET  /api/partners/platform-branding` — platform branding (login page uses this)
- `POST /api/partners` — partner self-registration
- `POST /api/auth/login` — login
- `POST /api/auth/refresh` — token refresh
- `POST /api/auth/token` — OAuth2 client_credentials

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- An AI provider (Azure OpenAI, OpenAI, or compatible — see [AI Provider Configuration](#ai-provider-configuration))

### Quick Start

```bash
# 1. Clone
git clone https://github.com/sprintly-exchange/business-exchange.git
cd business-exchange

# 2. Configure
cp .env.example .env
# Edit .env: set JWT_SECRET, ADMIN_PASSWORD, and AI provider credentials

# 3. Start everything
docker compose up -d

# 4. Open the portal
open http://localhost:11009
```

The database schema is applied automatically on first startup.

---

## Deployment

### Local — Docker Compose

```bash
docker compose up -d                    # start all services
docker compose up -d --build            # rebuild images first
docker compose up -d --build <service>  # rebuild a single service
docker compose logs -f <service>        # tail logs
docker compose down                     # stop all
```

Service URLs locally:

| Service | URL |
|---|---|
| Partner Portal | http://localhost:11009 |
| API Gateway | http://localhost:11000 |
| PostgreSQL | localhost:11007 |

---

### Fly.io (Recommended Cloud)

The project ships with a full **GitHub Actions CI/CD pipeline** for Fly.io — push to `main` and all services deploy automatically.

#### One-time setup

**1. Add GitHub Secrets** — go to repo → Settings → Secrets and variables → Actions:

| Secret | Description |
|---|---|
| `FLY_API_TOKEN` | From `flyctl auth token` |
| `JWT_SECRET` | Long random string for JWT signing |
| `DATABASE_URL` | Fly Postgres connection string (filled after step 3) |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key (if using Azure) |
| `OPENAI_API_KEY` | OpenAI key (if using OpenAI) |

**2. Add GitHub Variables** — same location, Variables tab:

| Variable | Example value |
|---|---|
| `FLY_ORG` | `personal` |
| `FLY_REGION` | `lhr` (London) · `iad` (US East) · `sin` (Singapore) |
| `GATEWAY_URL` | `https://bx-gateway.fly.dev` |
| `AI_PROVIDER` | `azure` · `openai` · `openai-compatible` |
| `AZURE_OPENAI_ENDPOINT` | `https://<resource>.openai.azure.com/` |
| `AZURE_OPENAI_DEPLOYMENT` | `gpt-4.1` |
| `AZURE_OPENAI_API_VERSION` | `2024-12-01-preview` |
| `OPENAI_MODEL` | `gpt-4o-mini` |

**3. Run the setup workflow** — GitHub → Actions → **🚀 Fly.io One-Time Setup** → Run workflow.

This provisions all 9 Fly apps, creates Fly Postgres, sets all secrets, and runs the DB migration.

**4. Done** — every push to `main` now auto-deploys via the **Deploy to Fly.io** workflow.

#### Deployment pipeline

```
push to main
  │
  ├─ migrate          (run 001_schema.sql against Fly Postgres)
  │
  ├─ deploy-backend   (7 services in parallel — auth, partner, subscription,
  │                    integration, mapping-engine, agent, billing)
  │
  ├─ deploy-gateway   (after all backends are healthy)
  │
  ├─ deploy-portal    (after gateway — passes GATEWAY_URL as build arg)
  │
  └─ smoke-test       (curl /health on gateway + portal)
```

#### Fly.io URLs

| Service | URL |
|---|---|
| Partner Portal | https://bx-partner-portal.fly.dev |
| API Gateway | https://bx-gateway.fly.dev |

Services communicate internally via Fly private networking (`*.internal`) — backend services are not exposed to the public internet.

---

### Azure Container Apps

The platform is also deployable to Azure Container Apps using the Bicep templates in `infra/bicep/`.

```bash
# Login
az login
az acr login --name bxacrprod

# Build and push (example for partner-portal)
SHA=$(git rev-parse --short HEAD)
docker buildx build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL=https://gateway.<env>.azurecontainerapps.io \
  -t bxacrprod.azurecr.io/partner-portal:$SHA \
  -f apps/partner-portal/Dockerfile . --push

az containerapp update \
  --name partner-portal \
  --resource-group <resource-group> \
  --image bxacrprod.azurecr.io/partner-portal:$SHA
```

Azure internal service URLs use the Container Apps internal DNS:
`http://auth-service:3001`, `http://partner-service:3002`, etc.

---

## White-Label Branding

The platform is fully white-labelable. An admin can configure:

| Setting | Where it appears |
|---|---|
| **Platform name** | Sidebar, login page, browser tab title |
| **Tagline** | Login page subtitle |
| **Logo** | Sidebar header + login page (URL or file upload) |
| **Primary / accent colors** | Buttons, active nav, accent elements |

**To configure:** sign in as admin → **Admin Settings → Platform Branding** → save.

Changes take effect immediately for all users without a redeploy.

Partners can also set their own branding (colors, logo) via **Settings → Partner Branding**, which overrides the platform defaults for their own views.

---

## AI Provider Configuration

The mapping-engine supports three AI providers controlled by a single env var:

```bash
# ── Azure OpenAI (default) ────────────────────────────────
AI_PROVIDER=azure
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
AZURE_OPENAI_API_VERSION=2024-12-01-preview

# ── Plain OpenAI ──────────────────────────────────────────
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# ── OpenAI-compatible (Groq, Ollama, Together AI, etc.) ───
AI_PROVIDER=openai-compatible
OPENAI_API_KEY=gsk_...
OPENAI_MODEL=llama-3.1-8b-instant
OPENAI_BASE_URL=https://api.groq.com/openai/v1
```

Switch providers at any time by updating the env var — no code changes needed.

---

## Admin Access

A platform admin user is created automatically on first startup.

| Field | Default |
|---|---|
| Username | `admin` |
| Password | `admin1234` (set `ADMIN_PASSWORD` in `.env` to override) |

Login at `/login` — the portal redirects admins to `/admin` automatically.

Admin capabilities:
- Approve / reject / suspend partner registrations
- Configure platform branding (white-label)
- Toggle demo mode
- Manage system settings (auto-approve, subscription limits)
- Billing admin (plans, usage, invoices)

> ⚠️ **Change the default admin password before going to production.**

---

## Demo Mode

Demo Mode seeds **5 pre-configured partner companies** with active subscriptions and messages across multiple formats — ideal for demos and testing.

### Activating Demo Mode

1. Sign in as admin → **Admin → System Settings**
2. Toggle **Demo Mode** — data is seeded in one transaction
3. Toggle off to cleanly remove all demo data

### Demo Partner Accounts

All demo partners share the password **`Demo@1234`**:

| Company | Email | Formats | Industry |
|---|---|---|---|
| **RetailSync Pro** | `api@retailsync-demo.io` | JSON, CSV, XML | Retail |
| **GlobalTrade Logistics** | `api@globaltrade-demo.io` | JSON, XML, EDI X12 | Logistics |
| **NexusPay Finance** | `connect@nexuspay-demo.io` | JSON, CSV | Payments |
| **AgroSupply Chain** | `edi@agrosupply-demo.io` | EDI X12, EDIFACT, CSV | Agriculture |
| **MediCore Systems** | `integration@medicore-demo.io` | XML, JSON | Healthcare |

### Pre-configured Integration Flows

```
RetailSync Pro ──────────────────► GlobalTrade Logistics   (JSON order, XML shipment, JSON invoice)
GlobalTrade Logistics ───────────► NexusPay Finance        (JSON payment, CSV remittance)
MediCore Systems ────────────────► AgroSupply Chain        (EDI X12 PO, XML invoice)
NexusPay Finance ────────────────► RetailSync Pro          (JSON invoice)
AgroSupply Chain ────────────────► GlobalTrade Logistics   (EDIFACT shipment notice)
```

### Demo Walkthrough

1. Sign in as `api@retailsync-demo.io` → explore dashboard, messages, subscriptions
2. Go to **Integration Hub** → see readiness checklist + delivery health per partner
3. Go to **Schema Mapping** → view auto-mapped schemas, validate integration with a partner
4. Sign in as admin → approve/manage partners, configure branding

---

## Key API Flows

All examples use `http://localhost:11000` (or your gateway URL).

### Register as a Partner
```bash
curl -X POST http://localhost:11000/api/partners \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Corp","domain":"acme.com","contactEmail":"api@acme.com","password":"secret123","supportedFormats":["json","xml"]}'
```

### Login
```bash
curl -X POST http://localhost:11000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"api@acme.com","password":"secret123"}'
# → { "data": { "accessToken": "...", "refreshToken": "..." } }
```

### Discover & Subscribe to a Partner
```bash
curl http://localhost:11000/api/subscriptions/discover -H "Authorization: Bearer <token>"

curl -X POST http://localhost:11000/api/subscriptions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"providerPartnerId":"<uuid>"}'
```

### Register a Schema (AI auto-maps it)
```bash
curl -X POST http://localhost:11000/api/mappings/schemas \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"format":"json","messageType":"ORDERS","samplePayload":"{\"orderId\":\"ORD-001\",\"total\":99.99}"}'
```

### Send a Message
```bash
curl -X POST http://localhost:11000/api/integrations/messages \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "X-Target-Partner-Id: <partner-uuid>" \
  -d '{"orderId":"ORD-001","total":99.99}'
```

---

## Project Structure

```
business-exchange/
├── apps/
│   ├── gateway/              # API Gateway — entry point for all traffic
│   ├── auth-service/         # JWT · refresh tokens · OAuth2 · API keys
│   ├── partner-service/      # Partner registration · KYB · branding API
│   ├── subscription-service/ # Partner discovery · subscription lifecycle
│   ├── integration-service/  # Message routing · webhook delivery · retry · validation handshake
│   ├── mapping-engine/       # AI schema inference (pluggable) · JSONata transforms
│   ├── agent-orchestrator/   # Cron-based autonomous agents
│   ├── billing-service/      # Plans · usage · invoices
│   └── partner-portal/       # Next.js 15 UI (React 19 + Tailwind)
│       └── src/app/
│           ├── dashboard/    # Overview stats
│           ├── partners/     # Partner catalog + discovery
│           ├── subscriptions/# Subscription management
│           ├── hub/          # Integration Hub — per-partner readiness
│           ├── integrations/ # Message monitor
│           ├── mappings/     # Schema mapping (AI auto-map, validate, CDM test)
│           ├── agents/       # Agent Monitor
│           ├── settings/     # Partner settings + branding
│           └── admin/        # Admin settings, branding, demo mode, billing
├── packages/
│   ├── shared-types/         # TypeScript interfaces (Partner, Message, Subscription…)
│   ├── shared-utils/         # UUID · HMAC signing · API key hashing · pagination
│   ├── database/             # pg pool · schema migration · admin seed
│   └── logger/               # Pino structured logger factory
├── infra/
│   ├── bicep/                # Azure Container Apps Bicep templates
│   └── fly/                  # Fly.io setup script
├── .github/workflows/
│   ├── deploy-fly.yml        # CI/CD: deploy all services to Fly.io on push to main
│   └── setup-fly.yml         # One-time: provision Fly apps, Postgres, secrets
├── docker-compose.yml        # Full-stack local environment
├── turbo.json                # Turborepo task graph
└── package.json              # Workspace root
```

---

## Autonomous Agents

The **agent-orchestrator** runs four background agents on a schedule:

| Agent | Schedule | What it does |
|---|---|---|
| **Monitor** | Every 1 min | Detects stuck messages, tracks per-partner error rates |
| **Retry** | Every 2 min | Retries failed webhook deliveries (3× exponential backoff) |
| **Schema Change** | Every 30 min | Detects payload drift against registered schemas |
| **Alert** | Every 5 min | Notifies on dead-lettered messages and schema drift events |

View live agent status at **Agent Monitor** in the portal sidebar.

---

## Development Commands

```bash
npm install                    # install all workspace dependencies
npm run dev                    # run all services with hot-reload
npm run build                  # build everything (Turbo — packages first)
npm run typecheck              # type-check all packages
npm run lint                   # lint all packages

cd apps/gateway && npm run dev # run a single service

# Apply DB schema manually (normally auto-applied by Docker)
docker exec -i bx-postgres psql -U bx_user -d business_exchange \
  < packages/database/migrations/001_schema.sql
```
