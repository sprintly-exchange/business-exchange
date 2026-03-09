// ─── All Container Apps (8 backend services + partner portal) ────────────────
param location              string
param tags                  object
param envId                 string
param acrLoginServer        string
param acrName               string

@secure()
param postgresUrl            string
@secure()
param jwtSecret              string
@secure()
param webhookSecret          string
@secure()
param azureOpenAiApiKey      string
param azureOpenAiEndpoint    string
param azureOpenAiDeployment  string
param azureOpenAiApiVersion  string
param adminEmail             string
@secure()
param adminPassword          string
param corsOrigin             string

// ── Pull ACR credentials ──────────────────────────────────────────────────────
resource acrResource 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}
var acrUser     = acrResource.listCredentials().username
var acrPassword = acrResource.listCredentials().passwords[0].value

// Internal service base URLs (Container Apps internal DNS)
var authUrl         = 'http://auth-service'
var partnerUrl      = 'http://partner-service'
var subscriptionUrl = 'http://subscription-service'
var integrationUrl  = 'http://integration-service'
var mappingUrl      = 'http://mapping-engine'
var agentUrl        = 'http://agent-orchestrator'
var billingUrl      = 'http://billing-service'

// ─────────────────────────────────────────────────────────────────────────────
// 1. auth-service
// ─────────────────────────────────────────────────────────────────────────────
resource authService 'Microsoft.App/containerApps@2023-11-02-preview' = {
  name: 'auth-service'
  location: location
  tags: tags
  properties: {
    environmentId: envId
    configuration: {
      ingress: { external: false, targetPort: 3001, transport: 'http' }
      registries: [{ server: acrLoginServer, username: acrUser, passwordSecretRef: 'acr-password' }]
      secrets: [
        { name: 'acr-password',   value: acrPassword }
        { name: 'postgres-url',   value: postgresUrl }
        { name: 'jwt-secret',     value: jwtSecret }
        { name: 'admin-password', value: adminPassword }
      ]
    }
    template: {
      containers: [{
        name: 'auth-service'
        image: '${acrLoginServer}/auth-service:latest'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'PORT',               value: '3001' }
          { name: 'DATABASE_URL',       secretRef: 'postgres-url' }
          { name: 'JWT_SECRET',         secretRef: 'jwt-secret' }
          { name: 'JWT_EXPIRES_IN',     value: '1h' }
          { name: 'REFRESH_EXPIRES_IN', value: '7 days' }
          { name: 'ADMIN_EMAIL',        value: adminEmail }
          { name: 'ADMIN_PASSWORD',     secretRef: 'admin-password' }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. partner-service
// ─────────────────────────────────────────────────────────────────────────────
resource partnerService 'Microsoft.App/containerApps@2023-11-02-preview' = {
  name: 'partner-service'
  location: location
  tags: tags
  properties: {
    environmentId: envId
    configuration: {
      ingress: { external: false, targetPort: 3002, transport: 'http' }
      registries: [{ server: acrLoginServer, username: acrUser, passwordSecretRef: 'acr-password' }]
      secrets: [
        { name: 'acr-password', value: acrPassword }
        { name: 'postgres-url', value: postgresUrl }
      ]
    }
    template: {
      containers: [{
        name: 'partner-service'
        image: '${acrLoginServer}/partner-service:latest'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'PORT',         value: '3002' }
          { name: 'DATABASE_URL', secretRef: 'postgres-url' }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. subscription-service
// ─────────────────────────────────────────────────────────────────────────────
resource subscriptionService 'Microsoft.App/containerApps@2023-11-02-preview' = {
  name: 'subscription-service'
  location: location
  tags: tags
  properties: {
    environmentId: envId
    configuration: {
      ingress: { external: false, targetPort: 3003, transport: 'http' }
      registries: [{ server: acrLoginServer, username: acrUser, passwordSecretRef: 'acr-password' }]
      secrets: [
        { name: 'acr-password', value: acrPassword }
        { name: 'postgres-url', value: postgresUrl }
      ]
    }
    template: {
      containers: [{
        name: 'subscription-service'
        image: '${acrLoginServer}/subscription-service:latest'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'PORT',         value: '3003' }
          { name: 'DATABASE_URL', secretRef: 'postgres-url' }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. integration-service
// ─────────────────────────────────────────────────────────────────────────────
resource integrationService 'Microsoft.App/containerApps@2023-11-02-preview' = {
  name: 'integration-service'
  location: location
  tags: tags
  properties: {
    environmentId: envId
    configuration: {
      ingress: { external: false, targetPort: 3004, transport: 'http' }
      registries: [{ server: acrLoginServer, username: acrUser, passwordSecretRef: 'acr-password' }]
      secrets: [
        { name: 'acr-password',   value: acrPassword }
        { name: 'postgres-url',   value: postgresUrl }
        { name: 'webhook-secret', value: webhookSecret }
      ]
    }
    template: {
      containers: [{
        name: 'integration-service'
        image: '${acrLoginServer}/integration-service:latest'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'PORT',           value: '3004' }
          { name: 'DATABASE_URL',   secretRef: 'postgres-url' }
          { name: 'WEBHOOK_SECRET', secretRef: 'webhook-secret' }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 5 }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. mapping-engine
// ─────────────────────────────────────────────────────────────────────────────
resource mappingEngine 'Microsoft.App/containerApps@2023-11-02-preview' = {
  name: 'mapping-engine'
  location: location
  tags: tags
  properties: {
    environmentId: envId
    configuration: {
      ingress: { external: false, targetPort: 3005, transport: 'http' }
      registries: [{ server: acrLoginServer, username: acrUser, passwordSecretRef: 'acr-password' }]
      secrets: [
        { name: 'acr-password', value: acrPassword }
        { name: 'postgres-url', value: postgresUrl }
        { name: 'aoai-api-key', value: azureOpenAiApiKey }
      ]
    }
    template: {
      containers: [{
        name: 'mapping-engine'
        image: '${acrLoginServer}/mapping-engine:latest'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'PORT',                     value: '3005' }
          { name: 'DATABASE_URL',             secretRef: 'postgres-url' }
          { name: 'AZURE_OPENAI_API_KEY',     secretRef: 'aoai-api-key' }
          { name: 'AZURE_OPENAI_ENDPOINT',    value: azureOpenAiEndpoint }
          { name: 'AZURE_OPENAI_DEPLOYMENT',  value: azureOpenAiDeployment }
          { name: 'AZURE_OPENAI_API_VERSION', value: azureOpenAiApiVersion }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. agent-orchestrator
// ─────────────────────────────────────────────────────────────────────────────
resource agentOrchestrator 'Microsoft.App/containerApps@2023-11-02-preview' = {
  name: 'agent-orchestrator'
  location: location
  tags: tags
  properties: {
    environmentId: envId
    configuration: {
      ingress: { external: false, targetPort: 3006, transport: 'http' }
      registries: [{ server: acrLoginServer, username: acrUser, passwordSecretRef: 'acr-password' }]
      secrets: [
        { name: 'acr-password',   value: acrPassword }
        { name: 'postgres-url',   value: postgresUrl }
        { name: 'webhook-secret', value: webhookSecret }
        { name: 'aoai-api-key',   value: azureOpenAiApiKey }
      ]
    }
    template: {
      containers: [{
        name: 'agent-orchestrator'
        image: '${acrLoginServer}/agent-orchestrator:latest'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'PORT',                     value: '3006' }
          { name: 'DATABASE_URL',             secretRef: 'postgres-url' }
          { name: 'WEBHOOK_SECRET',           secretRef: 'webhook-secret' }
          { name: 'AZURE_OPENAI_API_KEY',     secretRef: 'aoai-api-key' }
          { name: 'AZURE_OPENAI_ENDPOINT',    value: azureOpenAiEndpoint }
          { name: 'AZURE_OPENAI_DEPLOYMENT',  value: azureOpenAiDeployment }
          { name: 'AZURE_OPENAI_API_VERSION', value: azureOpenAiApiVersion }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. billing-service
// ─────────────────────────────────────────────────────────────────────────────
resource billingService 'Microsoft.App/containerApps@2023-11-02-preview' = {
  name: 'billing-service'
  location: location
  tags: tags
  properties: {
    environmentId: envId
    configuration: {
      ingress: { external: false, targetPort: 3007, transport: 'http' }
      registries: [{ server: acrLoginServer, username: acrUser, passwordSecretRef: 'acr-password' }]
      secrets: [
        { name: 'acr-password', value: acrPassword }
        { name: 'postgres-url', value: postgresUrl }
      ]
    }
    template: {
      containers: [{
        name: 'billing-service'
        image: '${acrLoginServer}/billing-service:latest'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'PORT',         value: '3007' }
          { name: 'DATABASE_URL', secretRef: 'postgres-url' }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 2 }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. gateway (PUBLIC)
// ─────────────────────────────────────────────────────────────────────────────
resource gateway 'Microsoft.App/containerApps@2023-11-02-preview' = {
  name: 'gateway'
  location: location
  tags: tags
  properties: {
    environmentId: envId
    configuration: {
      ingress: { external: true, targetPort: 3000, transport: 'http', allowInsecure: false }
      registries: [{ server: acrLoginServer, username: acrUser, passwordSecretRef: 'acr-password' }]
      secrets: [
        { name: 'acr-password', value: acrPassword }
        { name: 'jwt-secret',   value: jwtSecret }
      ]
    }
    template: {
      containers: [{
        name: 'gateway'
        image: '${acrLoginServer}/gateway:latest'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'PORT',                     value: '3000' }
          { name: 'JWT_SECRET',               secretRef: 'jwt-secret' }
          { name: 'AUTH_SERVICE_URL',         value: authUrl }
          { name: 'PARTNER_SERVICE_URL',      value: partnerUrl }
          { name: 'SUBSCRIPTION_SERVICE_URL', value: subscriptionUrl }
          { name: 'INTEGRATION_SERVICE_URL',  value: integrationUrl }
          { name: 'MAPPING_ENGINE_URL',       value: mappingUrl }
          { name: 'AGENT_ORCHESTRATOR_URL',   value: agentUrl }
          { name: 'BILLING_SERVICE_URL',      value: billingUrl }
          { name: 'CORS_ORIGIN',              value: corsOrigin }
          { name: 'RATE_LIMIT_MAX',           value: '1000' }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 5 }
    }
  }
  dependsOn: [
    authService
    partnerService
    subscriptionService
    integrationService
    mappingEngine
    agentOrchestrator
    billingService
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. partner-portal (PUBLIC)
// ─────────────────────────────────────────────────────────────────────────────
resource partnerPortal 'Microsoft.App/containerApps@2023-11-02-preview' = {
  name: 'partner-portal'
  location: location
  tags: tags
  properties: {
    environmentId: envId
    configuration: {
      ingress: { external: true, targetPort: 3100, transport: 'http', allowInsecure: false }
      registries: [{ server: acrLoginServer, username: acrUser, passwordSecretRef: 'acr-password' }]
      secrets: [
        { name: 'acr-password', value: acrPassword }
      ]
    }
    template: {
      containers: [{
        name: 'partner-portal'
        image: '${acrLoginServer}/partner-portal:latest'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'NEXT_PUBLIC_API_URL', value: 'https://${gateway.properties.configuration.ingress!.fqdn}' }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output gatewayUrl string = 'https://${gateway.properties.configuration.ingress!.fqdn}'
output portalUrl  string = 'https://${partnerPortal.properties.configuration.ingress!.fqdn}'
