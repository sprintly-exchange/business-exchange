// ─── Business Exchange — Azure Deployment ─────────────────────────────────────
// Resource Group : rg-aiin-business-exchange
// Region         : Sweden Central
//
// Usage:
//   az deployment group create \
//     --resource-group rg-aiin-business-exchange \
//     --template-file infra/bicep/main.bicep \
//     --parameters infra/bicep/main.bicepparam

targetScope = 'resourceGroup'

// ── Parameters ────────────────────────────────────────────────────────────────
@description('Azure region for all resources')
param location string = 'swedencentral'

@description('Environment tag: dev | staging | prod')
param environment string = 'prod'

@description('Short prefix for resource names')
param prefix string = 'bx'

@secure()
@description('PostgreSQL admin password')
param postgresAdminPassword string

@secure()
@description('JWT signing secret')
param jwtSecret string

@secure()
@description('Webhook HMAC secret')
param webhookSecret string

@description('Azure OpenAI API key')
@secure()
param azureOpenAiApiKey string

@description('Azure OpenAI endpoint (e.g. https://my-aoai.openai.azure.com/)')
param azureOpenAiEndpoint string

@description('Azure OpenAI deployment name')
param azureOpenAiDeployment string = 'gpt-4o-mini'

@description('Azure OpenAI API version')
param azureOpenAiApiVersion string = '2024-08-01-preview'

@description('Admin portal login email')
param adminEmail string = 'admin@businessexchange.io'

@secure()
@description('Admin portal login password')
param adminPassword string

@description('CORS allowed origin for the gateway (e.g. https://portal.yourdomain.com)')
param corsOrigin string = '*'

// ── Variables ─────────────────────────────────────────────────────────────────
var tags = {
  environment: environment
  project: 'business-exchange'
  managedBy: 'bicep'
}

var postgresServerName = '${prefix}-postgres-${environment}'
var postgresAdminUser  = 'bx_admin'
var postgresDbName     = 'business_exchange'
var acrName            = replace('${prefix}acr${environment}', '-', '')  // ACR allows only alphanumeric
var envName            = '${prefix}-env-${environment}'
var logName            = '${prefix}-logs-${environment}'

// ── Log Analytics (required by Container Apps) ────────────────────────────────
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── Modules ───────────────────────────────────────────────────────────────────
module acr 'modules/acr.bicep' = {
  name: 'acr'
  params: {
    acrName: acrName
    location: location
    tags: tags
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    serverName: postgresServerName
    location: location
    tags: tags
    adminUser: postgresAdminUser
    adminPassword: postgresAdminPassword
    dbName: postgresDbName
  }
}

module containerEnv 'modules/containerenv.bicep' = {
  name: 'containerenv'
  params: {
    envName: envName
    location: location
    tags: tags
    logAnalyticsCustomerId: logAnalytics.properties.customerId
    logAnalyticsSharedKey: logAnalytics.listKeys().primarySharedKey
  }
}

// Build connection strings
var postgresUrl = 'postgresql://${postgresAdminUser}:${postgresAdminPassword}@${postgres.outputs.fqdn}:5432/${postgresDbName}?sslmode=require'

module services 'modules/services.bicep' = {
  name: 'services'
  params: {
    location: location
    tags: tags
    envId: containerEnv.outputs.envId
    acrLoginServer: acr.outputs.loginServer
    acrName: acrName
    postgresUrl: postgresUrl
    jwtSecret: jwtSecret
    webhookSecret: webhookSecret
    azureOpenAiApiKey: azureOpenAiApiKey
    azureOpenAiEndpoint: azureOpenAiEndpoint
    azureOpenAiDeployment: azureOpenAiDeployment
    azureOpenAiApiVersion: azureOpenAiApiVersion
    adminEmail: adminEmail
    adminPassword: adminPassword
    corsOrigin: corsOrigin
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output acrLoginServer     string = acr.outputs.loginServer
output gatewayUrl         string = services.outputs.gatewayUrl
output portalUrl          string = services.outputs.portalUrl
output postgresHost       string = postgres.outputs.fqdn
