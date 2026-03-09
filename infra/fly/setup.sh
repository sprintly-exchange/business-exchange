#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Fly.io one-time setup script
# Run this ONCE locally before the GitHub Action takes over.
# Usage: bash infra/fly/setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config — edit these ───────────────────────────────────────────────────────
ORG="personal"          # or your Fly org slug
REGION="lhr"            # London — change to: iad (US), sin (Singapore), etc.

# Secrets — set these before running (or export them in your shell)
: "${JWT_SECRET:?Set JWT_SECRET env var}"
: "${DATABASE_URL:?Set DATABASE_URL env var — Fly Postgres connection string}"

# Optional AI (required for mapping-engine)
AI_PROVIDER="${AI_PROVIDER:-azure}"
AZURE_OPENAI_API_KEY="${AZURE_OPENAI_API_KEY:-}"
AZURE_OPENAI_ENDPOINT="${AZURE_OPENAI_ENDPOINT:-}"
AZURE_OPENAI_DEPLOYMENT="${AZURE_OPENAI_DEPLOYMENT:-gpt-4o-mini}"
AZURE_OPENAI_API_VERSION="${AZURE_OPENAI_API_VERSION:-2024-08-01-preview}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4o-mini}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-}"

echo "▶ Creating Fly apps..."
APPS=(
  bx-gateway
  bx-auth-service
  bx-partner-service
  bx-subscription-service
  bx-integration-service
  bx-mapping-engine
  bx-agent-orchestrator
  bx-billing-service
  bx-partner-portal
)

for app in "${APPS[@]}"; do
  if flyctl apps list | grep -q "$app"; then
    echo "  ✓ $app already exists — skipping"
  else
    flyctl apps create "$app" --org "$ORG"
    echo "  ✓ created $app"
  fi
done

echo ""
echo "▶ Creating Fly Postgres (if not exists)..."
if flyctl apps list | grep -q "bx-postgres"; then
  echo "  ✓ bx-postgres already exists"
else
  flyctl postgres create \
    --name bx-postgres \
    --org "$ORG" \
    --region "$REGION" \
    --vm-size shared-cpu-1x \
    --volume-size 10 \
    --initial-cluster-size 1
fi

echo ""
echo "▶ Setting secrets for backend services..."

BACKEND_APPS=(
  bx-auth-service
  bx-partner-service
  bx-subscription-service
  bx-integration-service
  bx-billing-service
  bx-agent-orchestrator
)

for app in "${BACKEND_APPS[@]}"; do
  flyctl secrets set -a "$app" \
    DATABASE_URL="$DATABASE_URL" \
    JWT_SECRET="$JWT_SECRET" \
    NODE_ENV="production"
  echo "  ✓ $app secrets set"
done

echo ""
echo "▶ Setting mapping-engine secrets (AI)..."
flyctl secrets set -a bx-mapping-engine \
  DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="$JWT_SECRET" \
  NODE_ENV="production" \
  AI_PROVIDER="$AI_PROVIDER" \
  AZURE_OPENAI_API_KEY="$AZURE_OPENAI_API_KEY" \
  AZURE_OPENAI_ENDPOINT="$AZURE_OPENAI_ENDPOINT" \
  AZURE_OPENAI_DEPLOYMENT="$AZURE_OPENAI_DEPLOYMENT" \
  AZURE_OPENAI_API_VERSION="$AZURE_OPENAI_API_VERSION" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  OPENAI_MODEL="$OPENAI_MODEL" \
  OPENAI_BASE_URL="$OPENAI_BASE_URL"

echo ""
echo "▶ Setting gateway secrets..."
flyctl secrets set -a bx-gateway \
  DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="$JWT_SECRET" \
  NODE_ENV="production"

echo ""
echo "▶ Running DB migration..."
flyctl postgres connect --app bx-postgres \
  --command "$(cat packages/database/migrations/001_schema.sql)" || true

echo ""
echo "────────────────────────────────────────────────────────────────"
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add FLY_API_TOKEN to GitHub repo secrets:"
echo "     flyctl auth token"
echo "     → GitHub repo → Settings → Secrets → New secret: FLY_API_TOKEN"
echo ""
echo "  2. Push to main to trigger the deployment:"
echo "     git push origin main"
echo ""
echo "  URLs after deploy:"
echo "     Portal:  https://bx-partner-portal.fly.dev"
echo "     Gateway: https://bx-gateway.fly.dev"
echo "────────────────────────────────────────────────────────────────"
