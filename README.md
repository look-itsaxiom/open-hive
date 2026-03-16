# Open Hive — Tapcheck Dogfood

**Internal deployment of [Open Hive](https://github.com/look-itsaxiom/open-hive) for the Tapcheck engineering team.**

This is Tapcheck's fork for testing Open Hive in a real team environment. Tapcheck-specific integrations (Teams alerts, Azure DevOps OAuth, etc.) live here. Upstream updates are pulled from `look-itsaxiom/open-hive`.

## Remotes

| Remote | Repo | Purpose |
|--------|------|---------|
| `origin` | `tapcheck-engineering/open-hive` | Tapcheck-specific builds |
| `upstream` | `look-itsaxiom/open-hive` | Upstream releases |

## Infrastructure

- **Subscription:** `product-ai-dev-001`
- **Resource Group:** `rg-open-hive-dogfood`
- **Runtime:** Azure Container Apps (single replica, SQLite + Azure Files)
- **Registry:** `cropenhivedogfood.azurecr.io`
- **Cleanup:** `az group delete -n rg-open-hive-dogfood`

## Deployment Plan

### 1. Create Resource Group
```bash
az account set --subscription product-ai-dev-001
az group create -n rg-open-hive-dogfood -l centralus
```

### 2. Create Storage (SQLite persistence)
```bash
az storage account create -n stopenhivedogfood -g rg-open-hive-dogfood -l centralus --sku Standard_LRS --kind StorageV2
az storage share create -n openhive-data --account-name stopenhivedogfood
```

### 3. Create Container Registry
```bash
az acr create -n cropenhivedogfood -g rg-open-hive-dogfood -l centralus --sku Basic --admin-enabled true
```

### 4. Build & Push Image
```bash
az acr login -n cropenhivedogfood
docker build -t cropenhivedogfood.azurecr.io/open-hive:latest -f packages/backend/Dockerfile .
docker push cropenhivedogfood.azurecr.io/open-hive:latest
```

### 5. Create Log Analytics + Container Apps Environment
```bash
az monitor log-analytics workspace create -n law-openhive-dogfood -g rg-open-hive-dogfood -l centralus

LAW_ID=$(az monitor log-analytics workspace show -n law-openhive-dogfood -g rg-open-hive-dogfood --query customerId -o tsv)
LAW_KEY=$(az monitor log-analytics workspace get-shared-keys -n law-openhive-dogfood -g rg-open-hive-dogfood --query primarySharedKey -o tsv)

az containerapp env create \
  -n cae-openhive-dogfood \
  -g rg-open-hive-dogfood \
  -l centralus \
  --logs-workspace-id $LAW_ID \
  --logs-workspace-key $LAW_KEY
```

### 6. Add Storage Mount
```bash
STORAGE_KEY=$(az storage account keys list -n stopenhivedogfood --query "[0].value" -o tsv)

az containerapp env storage set \
  -n cae-openhive-dogfood \
  -g rg-open-hive-dogfood \
  -a stopenhivedogfood \
  --storage-name openhive-data \
  --azure-file-account-key $STORAGE_KEY \
  --azure-file-share-name openhive-data \
  --access-mode ReadWrite
```

### 7. Deploy Container App
```bash
ACR_USER=$(az acr credential show -n cropenhivedogfood --query username -o tsv)
ACR_PASS=$(az acr credential show -n cropenhivedogfood --query "passwords[0].value" -o tsv)

az containerapp create \
  -n ca-openhive-dev \
  -g rg-open-hive-dogfood \
  --environment cae-openhive-dogfood \
  --image cropenhivedogfood.azurecr.io/open-hive:latest \
  --registry-server cropenhivedogfood.azurecr.io \
  --registry-username $ACR_USER \
  --registry-password $ACR_PASS \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1Gi \
  --env-vars \
    PORT=3000 \
    DB_TYPE=sqlite \
    DATABASE_URL=/data/hive.db \
    COLLISION_SCOPE=org \
    DECAY_ENABLED=true \
    DECAY_HALF_LIFE=86400
```

Then mount the volume:
```bash
az containerapp update \
  -n ca-openhive-dev \
  -g rg-open-hive-dogfood \
  --set-env-vars DATABASE_URL=/data/hive.db \
  --yaml <(cat <<'EOF'
properties:
  template:
    volumes:
      - name: openhive-data
        storageName: openhive-data
        storageType: AzureFile
    containers:
      - name: ca-openhive-dev
        volumeMounts:
          - volumeName: openhive-data
            mountPath: /data
EOF
)
```

### 8. Verify
```bash
FQDN=$(az containerapp show -n ca-openhive-dev -g rg-open-hive-dogfood --query "properties.configuration.ingress.fqdn" -o tsv)
curl https://$FQDN/api/health
```

Expected: `{"status":"ok","version":"0.3.0","active_nerves":0}`

## Syncing Upstream

```bash
git fetch upstream
git merge upstream/main
```

## Field Notes

Track dogfood observations in the [workshop project](~/.open-workshop/projects/open-hive-dogfood-tapcheck/).
