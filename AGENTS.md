# AGENTS.md

## Minis Agent Operating Rules

### Architecture Truth Model
- GitHub is the source of truth for code.
- Azure SQL is the source of truth for data.
- Azure App Service is the runtime for API and business logic.
- Cloudflare R2 JSON is a published cache layer, never the data source of truth.
- Frontend/PWA reads from R2 JSON first, then falls back to API.
- Writes always flow through API -> DB.

## 1. Core Principles
- Treat Azure SQL as the only business source of truth.
- Treat R2 JSON as derived cache; it must always be rebuildable from DB.
- Do not write directly to DB outside backend API logic.
- Keep read paths and write paths explicitly separated.

## 2. Environments
- Supported environments: `local`, `staging`, `production`.
- Validate all behavior in staging before production.
- Do not deploy directly to production without prior staging validation.

## 3. Backend Rules
- Keep all business logic in backend code.
- Use one publishing entry point: `PublishShopJsonAsync(shopId)`.
- Never manually edit R2 JSON; always regenerate from DB state.
- Add logs for critical flows, especially payments and JSON publishing.

## 4. Frontend Rules
- Prefer R2 JSON for read operations.
- Use API fallback when R2 JSON read fails or is unavailable.
- Do not hardcode localhost URLs; use environment-aware base URLs.

## 5. Payment Rules
- Payment operations must be idempotent.
- Persist payment attempts before provider calls.
- Support and preserve payment states:
  - `PendingPayment`
  - `Paid`
  - `Failed`
  - `PaymentUnknown`
- If provider response is unclear, do not assume failure.

## 6. Safety Rules
- Never run destructive SQL without explicit user approval.
- Use read-only DB access for investigation and reporting queries.
- Never expose or commit secrets/connection strings.
- Do not modify production configuration without explicit intent.

## 7. Development Workflow
- Follow: branch -> PR -> merge -> deploy to staging.
- Validate in staging before production swap/promotion.
- Prefer small, focused, reversible changes.

## 8. JSON Publishing Rules
- Publish path format must be: `json/{shopId}.json`.
- Always overwrite the full JSON file; do not patch partial fragments.
- Include `updatedAtUtc` and `version` fields in published payloads.
- Validate JSON structure and serialization before upload.

## 9. Debugging Rules
- Use `/health` and `/version` first for runtime validation.
- Logs must include environment and identifiers (`orderId`, `shopId`).
- Confirm deployed version/build before deeper debugging.
