# Cowork ↔ CNCxSOHO MCP Integration Runbook

**Branch:** `feat/cowork-mcp-integration`
**Built:** 2026-05-16
**Status:** Implementation complete (Phases 0–6). Phase 7 (deployment + Cowork connection) follows the steps below.

## What's deployed

A custom MCP server at `/mcp` on the existing Express app. **25 tools** exposed:

| Tier | Count | Tools |
|---|---|---|
| read | 10 | `read_procedures`, `read_procedure_detail`, `read_taxes`, `read_expenses`, `read_payments`, `read_invoices`, `read_products`, `read_hs_codes`, `read_time_series`, `read_audit_log` |
| write | 11 | `write_create_procedure`, `write_update_procedure`, `write_create_import_expense`, `write_create_service_invoice`, `write_create_payment`, `write_distribute_payment`, `write_create_invoice_with_line_items`, `write_create_product`, `write_calculate_tax`, `write_import_excel`, `write_attach_document` |
| ai | 2 | `ai_extract_pdf`, `ai_ask_internal` |
| destructive | 2 | `destructive_delete_record` (default `dry_run:true`), `destructive_close_procedure` (default `dry_run:true`) |

Every call is recorded in `agent_audit_log` (token fingerprint, args sanitized, before-state for updates, duration). Read via `read_audit_log` MCP tool or directly:
```sql
SELECT ts, tool, tier, result_status, result_summary, duration_ms
FROM agent_audit_log
ORDER BY ts DESC
LIMIT 20;
```

## Local Cowork Test (Pre-Production)

Cowork is Anthropic-hosted; it cannot reach `localhost:5000` directly. Use ngrok for the first end-to-end test.

### 1. Start dev server

```bash
npx tsx --env-file=.env server/index.ts
```
(or `npm run dev` on macOS/Linux — Windows users must use the `--env-file` form because the project's `npm run dev` script uses Unix env-var syntax)

Verify:
```bash
curl http://localhost:5000/mcp/health
```
Expected: `{"status":"ok","server":"cncxsoho-mcp","ts":"..."}`

### 2. Expose via ngrok

```bash
ngrok http 5000
```
Copy the HTTPS URL (e.g., `https://abcd1234.ngrok-free.app`). Your MCP endpoint is `https://abcd1234.ngrok-free.app/mcp`.

### 3. Add to Cowork

Claude Desktop → **Cowork** → Customize → Custom MCP servers (or equivalent connector UI):
- **Name:** CNCxSOHO Dev
- **URL:** `https://<ngrok-url>/mcp`
- **Auth:** Bearer, paste the value of `MCP_BEARER_TOKEN` from your `.env`
- Save / Connect.

Expected: Cowork shows tool count = 25.

### 4. Smoke prompts from Cowork

In a new Cowork task:

| Prompt | Expected tool call | Expected outcome |
|---|---|---|
| "List my 5 most recent import procedures." | `read_procedures` with `list_limit: 5` | Table of 5 procedures |
| "What are total customs taxes for ALO in 2026?" | `read_taxes` or `ai_ask_internal` | Aggregated number |
| "Show me the last 5 entries in the agent audit log." | `read_audit_log` with `limit: 5` | Table of recent tool calls including this conversation's |

Verify each:
- Cowork shows a tool call card with the tool name (in its UI).
- Response is structured (table or paragraph), not "I cannot access your data."
- `agent_audit_log` table grows by one row per call.

## Production Deployment

### 1. Push branch to GitHub (or wherever main is hosted)

```bash
git push -u origin feat/cowork-mcp-integration
```

If you want this work directly on `main`, merge or fast-forward main to this branch instead of opening a PR. Note that this branch also contains the `fix(custom-report): rename duplicate const lastCol` commit — that bug exists on `main` and is unrelated to MCP but breaks `npm run dev`; cherry-pick it to `main` even if you don't merge the full branch.

### 2. Deploy app to VPS

SSH to the production server. From the deployed checkout:

```bash
git fetch origin
git checkout feat/cowork-mcp-integration   # or merge it to main first, then git pull
npm install                                 # picks up @modelcontextprotocol/sdk
npm run build                               # vite build + esbuild server
pm2 reload ecosystem.config.cjs --update-env
```

Verify:
```bash
curl https://cncsohoimportmanager.com/mcp/health
```
Expected: `{"status":"ok","server":"cncxsoho-mcp","ts":"..."}`

### 3. Generate a production token and set env

On the VPS:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Add to the production `.env`:
```
MCP_BEARER_TOKEN=<paste production token here — different from dev>
MCP_AGENT_ID=cowork
# Optional but recommended: dedicate a users.id for MCP attribution
MCP_AGENT_USER_ID=
```

Reload PM2 so it picks up env changes:
```bash
pm2 reload ecosystem.config.cjs --update-env
```

### 4. Apply nginx snippet

The `/mcp` endpoint needs longer keep-alives than the default 60s for SSE-style streaming. Merge `nginx/cncsoho.mcp.conf.snippet` into the production config:

```bash
sudo $EDITOR /etc/nginx/sites-available/cncsohoimportmanager.com
# Paste the snippet ABOVE any catch-all `location /` block
sudo nginx -t           # validate
sudo nginx -s reload
```

Verify the new timeout is in effect:
```bash
sudo nginx -T | grep -A 5 'location /mcp'
```

### 5. Apply DB DDL on production

The `agent_audit_log` table + enum types + indexes need to exist on the production database. Apply `db/manual-ddl/000_agent_audit_log_indexes.sql`:

```bash
# Connect to production Neon via psql, OR run via the project's db helper:
psql "$DATABASE_URL" -f db/manual-ddl/000_agent_audit_log_indexes.sql
```

Verify:
```bash
psql "$DATABASE_URL" -c "\d agent_audit_log"
```
Expected: 14 columns (id, ts, agent_id, token_fingerprint, tool, tier, args_json, before_json, result_status, result_summary, affected_table, affected_ids, duration_ms, transaction_id) plus 3 indexes (ts, tool+ts, transaction_id).

### 6. Re-connect Cowork to production URL

Cowork → connector settings:
- URL: `https://cncsohoimportmanager.com/mcp`
- Bearer token: the **production** value (NOT dev)
- Save.

Re-run the smoke prompts from the local test against production.

## Optional: Cowork-Side Workflows

### Gmail-triggered tax calculation

Cowork → **Dispatch (Beta)**:
- Trigger: Gmail filter (e.g., `from:supplier@example.com subject:"Invoice"`).
- Task prompt:
  > Process the incoming invoice email. Call `ai_extract_pdf` on the PDF attachment. Identify the related procedure by matching invoice number to recent procedures (use `read_procedures`). If found, call `write_calculate_tax` for that procedure. Otherwise, summarize the extracted data and ask the user which procedure to link.

If Dispatch does not support attachments directly, drop down to a notification-only flow: Cowork notifies you when the email arrives, you forward the PDF manually.

### Scheduled monthly summary

Cowork → **Scheduled**:
- Cron: Every 1st of the month at 09:00 Istanbul time.
- Task prompt:
  > Call `read_time_series` with `table:'taxes'` and `bucket:'month'`. Summarize the previous month's customs/VAT/KKDF totals. Also call `read_procedures` for procedures arrived in that month and group by company. Email me the result.

## Operating the System

### How to rotate the bearer token

1. Generate new token: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
2. Update production `.env`: `MCP_BEARER_TOKEN=<new>`
3. `pm2 reload ecosystem.config.cjs --update-env`
4. Update Cowork connector with new token.
5. Old token is now invalid; verify by re-running smoke prompts.

(There is no token-overlap window in v1 — calls in flight at rotation time will fail. Pause Cowork tasks during rotation or accept a transient error.)

### How to inspect agent activity

In Cowork or `psql`:
```sql
SELECT ts, tool, tier, result_status,
       LEFT(result_summary, 80) AS summary,
       duration_ms
FROM agent_audit_log
WHERE ts > NOW() - INTERVAL '1 day'
ORDER BY ts DESC;
```

Or via MCP itself:
```
ai_ask_internal("How many MCP tool calls did the agent make in the last 24 hours, grouped by tool name?")
```
…although `ai_ask_internal` doesn't currently have access to `agent_audit_log` — for that, ask Cowork directly to call `read_audit_log` with appropriate filters.

### Known limitations

- **`destructive_close_procedure` only updates `procedures.status` to `'completed'`** — the project's import workflow also has `shipment_status`, `payment_status`, and `document_status` enums where `'closed'` is the terminal value. If your domain "close" means closing all four, the tool needs to be expanded.
- **`write_import_excel` requires Drizzle camelCase headers** in the xlsx (e.g. `procedureReference`, not `procedure_reference`). Unknown columns are silently dropped. NOT NULL violations surface as raw Postgres errors.
- **`write_calculate_tax` does not load ATR rate overrides** — for ATR-enabled procedures, item-level customs rates won't be applied correctly. Future enhancement: load via `storage.getAtrCustomsRates(uniqueHsCodes)` (same as the existing `calculateAllItems` orchestration).
- **`write_attach_document` uses the legacy `procedureDocuments` table**, not the richer `expense_documents` table. Future enhancement: add `write_attach_expense_document`.
- **MCP schema descriptions advertise some fields not in the actual procedures table** (`company`, `notes`, `origin_country`). Drizzle silently drops them. Cowork may try to pass them; doesn't break anything but is misleading. A follow-up cleanup pass should trim these descriptions to real columns.
- **Pre-existing schema drift** on `atr_customs_rates` and `country_code_mappings` (unique constraints not yet in DB) means `npm run db:push` is currently blocked. The MCP table was added via manual DDL to work around this. Fix the drift before any future schema additions via `drizzle-kit`.

### Open test data to clean up

These rows were created by smoke tests during the build:

```sql
DELETE FROM procedures WHERE id IN (178, 179);  -- from Phase 4.1 verify-write-tools.ts
DELETE FROM products WHERE id = 1601;             -- from Phase 4.2 verify-write-product.ts (style: MCP-TEST-PROD-1778938043536)
```

Or do it through MCP itself (proves destructive_delete works):
```
destructive_delete_record({ table: "procedures", id: 178, dry_run: false })
destructive_delete_record({ table: "procedures", id: 179, dry_run: false })
destructive_delete_record({ table: "products",    id: 1601, dry_run: false })
```
