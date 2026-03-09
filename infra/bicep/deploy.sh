#!/usr/bin/env bash
# ─── Business Exchange — Azure Deployment Script ──────────────────────────────
# Resource Group : rg-aiin-business-exchange
# Region         : Sweden Central
#
# Prerequisites:
#   az login
#   az account set --subscription <your-subscription-id>
#   docker (running)
#
# Usage:
#   chmod +x infra/bicep/deploy.sh
#   ./infra/bicep/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RESOURCE_GROUP="rg-aiin-business-exchange"
LOCATION="swedencentral"
PREFIX="bx"
ENV="prod"
ACR_NAME="${PREFIX}acr${ENV}"          # bxacrprod
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Services to build and push (matches Dockerfile paths)
SERVICES=(
  gateway
  auth-service
  partner-service
  subscription-service
  integration-service
  mapping-engine
  agent-orchestrator
  billing-service
  partner-portal
)

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       Business Exchange — Azure Deployment               ║"
echo "║  Resource Group : ${RESOURCE_GROUP}  ║"
echo "║  Region         : ${LOCATION}                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Ensure resource group exists ─────────────────────────────────────
echo "▶ Step 1/5 — Ensuring resource group exists..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none
echo "  ✓ Resource group ready"

# ── Step 2: Deploy infrastructure (Bicep — idempotent) ───────────────────────
echo ""
echo "▶ Step 2/5 — Deploying infrastructure via Bicep..."
echo "  This creates: ACR, PostgreSQL, Container Apps Environment"
echo "  (takes ~5-10 minutes on first run)"

DEPLOY_OUTPUT=$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "${SCRIPT_DIR}/main.bicep" \
  --parameters "${SCRIPT_DIR}/main.bicepparam" \
  --query "properties.outputs" \
  --output json)

ACR_LOGIN_SERVER=$(echo "$DEPLOY_OUTPUT" | jq -r '.acrLoginServer.value')
echo "  ✓ Infrastructure deployed"
echo "  ✓ ACR: ${ACR_LOGIN_SERVER}"

# ── Step 3: Log in to ACR ─────────────────────────────────────────────────────
echo ""
echo "▶ Step 3/5 — Logging in to Azure Container Registry..."
az acr login --name "$ACR_NAME"
echo "  ✓ ACR login successful"

# ── Step 4: Build and push all Docker images ──────────────────────────────────
echo ""
echo "▶ Step 4/5 — Building and pushing Docker images..."
cd "$ROOT_DIR"

for SERVICE in "${SERVICES[@]}"; do
  DOCKERFILE="apps/${SERVICE}/Dockerfile"
  IMAGE_TAG="${ACR_LOGIN_SERVER}/${SERVICE}:latest"

  if [ ! -f "$DOCKERFILE" ]; then
    echo "  ⚠ Skipping ${SERVICE} — no Dockerfile found at ${DOCKERFILE}"
    continue
  fi

  echo "  → Building ${SERVICE}..."
  docker build \
    --platform linux/amd64 \
    --file "$DOCKERFILE" \
    --tag "$IMAGE_TAG" \
    --quiet \
    .

  echo "  → Pushing ${SERVICE}..."
  docker push "$IMAGE_TAG" --quiet

  echo "  ✓ ${SERVICE} pushed"
done

# ── Step 5: Redeploy Container Apps (pick up new images) ─────────────────────
echo ""
echo "▶ Step 5/5 — Redeploying Container Apps with latest images..."
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "${SCRIPT_DIR}/main.bicep" \
  --parameters "${SCRIPT_DIR}/main.bicepparam" \
  --output none

# ── Output URLs ───────────────────────────────────────────────────────────────
FINAL_OUTPUT=$(az deployment group show \
  --resource-group "$RESOURCE_GROUP" \
  --name "main" \
  --query "properties.outputs" \
  --output json)

GATEWAY_URL=$(echo "$FINAL_OUTPUT" | jq -r '.gatewayUrl.value')
PORTAL_URL=$(echo "$FINAL_OUTPUT"  | jq -r '.portalUrl.value')

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              ✅  Deployment Complete                     ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Portal  : ${PORTAL_URL}"
echo "║  API     : ${GATEWAY_URL}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "⚠  IMPORTANT — run DB migrations:"
echo "   The PostgreSQL database needs the schema applied."
echo "   Connect via:"
echo "   psql \"\$(az postgres flexible-server show-connection-string \\"
echo "     --server-name ${PREFIX}-postgres-${ENV} \\"
echo "     --database-name business_exchange \\"
echo "     --admin-user bx_admin \\"
echo "     --query connectionStrings.psql_cmd -o tsv)\""
echo ""
echo "   Then run: \\i packages/database/migrations/001_schema.sql"
