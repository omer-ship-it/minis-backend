# Minis Architecture

## Overview

Minis is built as a layered system with a clear separation between:

- **Code truth**
- **Data truth**
- **Published read cache**
- **Runtime environments**

The goal is to keep the system fast, resilient, and easy to reason about.

---

## Core Principles

### 1. Source of truth
- **GitHub** is the source of truth for code.
- **Azure SQL** is the source of truth for business data.
- **Cloudflare R2 JSON** is a published cache, not the source of truth.

### 2. Read vs write separation
- **Writes** go through the backend API and persist to Azure SQL.
- **Reads** should prefer published JSON from Cloudflare R2 where possible.
- If published JSON is unavailable, the frontend can fall back to the API.

### 3. Deployment safety
- All changes are developed locally first.
- Changes are deployed to **staging** before production.
- Production should only be updated after validation in staging.

### 4. Rebuildability
- Any published JSON must always be rebuildable from the database.
- Azure runtime files are not treated as the source of truth.

---

## System Components

## 1. Development Layer

### Mac
Development happens locally on macOS using:

- **Xcode** for iOS / App Clip / SwiftUI
- **VS Code** for backend, PWA, scripts, and SQL work
- **Codex** as the coding assistant in Xcode and VS Code

### Local environments
Local development supports:
- local backend runtime
- local frontend/PWA testing
- local SQL querying against Azure SQL through a safe read-only runner

---

## 2. Code Layer

### GitHub
GitHub is the source of truth for all code and deployment automation.

Responsibilities:
- store backend, frontend, and app code
- keep version history
- manage PR flow and CI/CD
- trigger deployments

### Branching model
Recommended flow:
- feature branch
- PR
- CI
- merge
- deploy to staging
- validate
- promote to production

Direct pushes to `main` should be minimized.

---

## 3. Backend Runtime Layer

### Azure App Service
The backend API runs on Azure App Service.

Responsibilities:
- serve API endpoints
- optionally serve PWA/static assets during current phase
- generate and publish JSON to Cloudflare R2
- handle order and payment logic
- connect to Azure SQL

### Slots
- **Production slot** = live runtime
- **Staging slot** = validation runtime

Domains:
- `api.minis.studio` → production
- `staging-api.minis.studio` → staging

---

## 4. Database Layer

### Azure SQL
Azure SQL is the business source of truth.

Responsibilities:
- products
- orders
- customers
- teams
- payments metadata
- app state that must persist reliably

Rules:
- all writes must end here
- all published JSON is derived from here
- no business truth should live only in R2 JSON

### Database access model
Use separate identities:
- **admin user** for setup and migrations
- **app user** for backend runtime
- **read-only user** for querying/debugging/Codex tooling

---

## 5. Published Read Layer

### Cloudflare R2
Cloudflare R2 stores published shop JSON files.

Examples:
- `json/12.json`
- `json/13.json`

Responsibilities:
- fast public reads
- CDN-friendly delivery
- menu/shop data delivery for frontend

Important:
- R2 JSON is a **cache/output layer**
- R2 JSON must always be reproducible from Azure SQL

### Publishing model
Product/shop changes should eventually trigger:

`PublishShopJsonAsync(shopId)`

This process should:
1. load current data from Azure SQL
2. build a complete JSON payload
3. validate payload
4. upload to R2
5. overwrite `json/{shopId}.json`

---

## 6. Frontend Read Flow

### Preferred read path
Frontend should prefer:

`Cloudflare R2 JSON`

Example:
`https://minis.studio/json/12.json`

### Fallback read path
If R2 is unavailable:
- frontend can fall back to backend API

### Optional local cache
Frontend may cache the latest valid JSON locally to improve resilience.

---

## 7. Write Flow

### Products / admin changes
Write path:

`Frontend/Admin → API → Azure SQL → Publish JSON → R2`

### Orders / payments
Write path:

`Client → API → Azure SQL`

For payments, the order/payment intent should be saved before or during external provider interaction so that failures are recoverable.

---

## 8. Payment Architecture

### Current payment principles
- payment logic must be idempotent
- payment attempts must be traceable
- ambiguous provider outcomes must not be treated as simple failure

### Recommended payment states
- `PendingPayment`
- `Paid`
- `Failed`
- `PaymentUnknown`
- `Cancelled`
- `Refunded`

### Provider model
Even if only one provider is used now, the schema should already support:
- `PaymentProvider`
- `TransactionId`
- `Reference`
- `PaymentAttemptId`

This allows future fallback provider support and reconciliation.

---

## 9. Resilience Strategy

### Read resilience
If one component is down:
- R2 can serve published JSON
- API can serve fallback reads
- frontend can optionally use cached last-known data

### Write resilience
Writes are more critical than reads.
Priorities:
- preserve intent
- avoid double charges
- never fake success
- reconcile ambiguous cases later

### Truth hierarchy during incidents
1. Azure SQL = business truth
2. GitHub = code truth
3. R2 = rebuildable published cache

---

## 10. Environments

### Local
Used for:
- active development
- rapid iteration
- endpoint debugging

### Staging
Used for:
- real deployment validation
- cloud environment testing
- smoke testing before release

### Production
Used for:
- live traffic
- stable runtime only after validation

---

## 11. Debugging Model

### GitHub
Use GitHub for:
- code history
- PRs
- workflow history
- deployment triggers

### Azure
Use Azure for:
- runtime health
- logs
- environment configuration
- slot validation

### SQL tooling
Use VS Code / SQL tools for:
- schema inspection
- read-only queries
- debugging data state

### Versioning
Backend should expose:
- `/health`
- `/version`
- optionally `/health/full`

This makes it clear what version is running in each environment.

---

## 12. Current Direction

Current architecture target:

- **Xcode + Codex** for iOS
- **VS Code + Codex** for backend/PWA/scripts
- **GitHub** for code truth and CI/CD
- **Azure App Service** for API runtime
- **Azure SQL** for data truth
- **Cloudflare R2** for published JSON delivery

This is the foundational architecture for Minis going forward.

---

## 13. Future Evolution

Planned improvements may include:
- full `PublishShopJsonAsync(shopId)` pipeline
- nightly republish-all job
- multi-provider payment fallback
- DB failover group
- multi-region API failover
- stronger reconciliation and monitoring

---

## Summary

Minis is designed around a simple rule:

- **GitHub owns code**
- **Azure SQL owns truth**
- **Azure App Service runs logic**
- **Cloudflare R2 serves published read data**

Everything else should support that model.
