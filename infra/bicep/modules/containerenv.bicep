// ─── Container Apps Environment ───────────────────────────────────────────────
param envName                   string
param location                  string
param tags                      object
param logAnalyticsCustomerId    string
@secure()
param logAnalyticsSharedKey     string

resource env 'Microsoft.App/managedEnvironments@2023-11-02-preview' = {
  name: envName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
  }
}

output envId   string = env.id
output envName string = env.name
