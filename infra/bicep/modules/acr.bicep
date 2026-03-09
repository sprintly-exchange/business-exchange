// ─── Azure Container Registry ─────────────────────────────────────────────────
param acrName    string
param location   string
param tags       object

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: true   // needed so Container Apps can pull images
  }
}

output loginServer string = acr.properties.loginServer
output acrId       string = acr.id
