# eu-ai-act-compliance-d1

Cloudflare Worker that fronts the **Comply AI** D1 database. It serves three things:

1. **Regulatory content API** (`/api/v1/*`): the EU AI Act compliance calendar (JSON, iCalendar and an embeddable widget), a sourced regulatory-update feed, two compliance checklists, and the 13-module Article 4 AI-literacy library in English and Swedish, all kept current with the Act as amended by the Digital Omnibus on AI (Regulation (EU) 2026/1744).
2. **Commercial model**: the plan and pack catalogue with entitlements, per-tenant entitlement resolution (pack expiry, per-seat counts) and the Article 4 evidence report data.
3. **Generic data access** (`/rest/*`, `/query`): authenticated CRUD and raw SQL against every table, used by the Comply AI Flask application.

Content is authored as JSON under `content/`, validated and compiled into `seeds/content.sql`, and applied after the D1 migrations. See `docs/REGULATORY_CHANGELOG.md` for what changed in the regulation and when, with sources, and `docs/PRICING.md` for the commercial model and Stripe setup.

## Stack

- Cloudflare Workers + Hono
- Cloudflare D1 (`eu-ai-act-compliance`, binding `DB`)
- Cloudflare Secrets Store for the API bearer token (binding `SECRET`); `API_SECRET` var as local fallback
- TypeScript, Wrangler 4

## Quick start (local)

```bash
npm install
npm run db:setup:local       # content:build + migrations + seed on the local D1
npm run dev                  # http://localhost:8787 with API_SECRET=dev-secret
npm run test:smoke           # in a second terminal: 65 end-to-end checks
npm run typecheck
```

## Deploy

```bash
npm run content:build
npm run db:migrate:remote    # schema migrations (0001, 0003); safe to re-run
npm run db:seed:remote       # content and plans; INSERT OR REPLACE makes it idempotent
npm run deploy
```

When only content changes (a new deadline, a revised module, a price):

```bash
npm run content:build
npm run db:seed:remote
```

Migration `0003` adds `plan`, `seats`, `plan_expires_at`, `stripe_subscription` and `locale` to the
Flask app's `tenants` table and maps existing `tier` values onto the legacy plans. Run it before
deploying the matching Flask changes.

The remote secret is set once in the Cloudflare dashboard (Secrets Store, secret `eu-ai-act-compliance-secret`) and read by the worker at first request.

## API

All responses are JSON. Public endpoints send `Cache-Control: public, max-age=300, s-maxage=900`.

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness and D1 reachability |
| GET | `/api/v1/deadlines` | Compliance calendar, oldest first, with `days_remaining`, `phase` and `next_deadline` |
| GET | `/api/v1/deadlines.ics` | The same calendar as an iCalendar feed (subscribe from Outlook or Google Calendar) |
| GET | `/embed/deadlines?brand=&accent=&limit=` | Embeddable HTML widget of upcoming deadlines for partner and advisor sites |
| GET | `/api/v1/regulatory-updates?limit=20&category=` | Update feed, newest first. Categories: `legislation`, `guidance`, `standards`, `enforcement`, `code_of_practice` |
| GET | `/api/v1/plans` | Active plans and packs with prices and entitlements |
| GET | `/api/v1/checklists?locale=` | Checklist catalogue with item counts (no items) |
| GET | `/api/v1/training/modules?tier=free&locale=` | Module catalogue (no lesson content). `locked` is computed from `tier`; `locale=sv` overlays Swedish where translated |

### Authenticated (`Authorization: Bearer <secret>`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/plans?include_inactive=1` | All plans including grandfathered ones |
| GET | `/api/v1/checklists/:id?locale=` | Full checklist sections and items |
| GET | `/api/v1/training/modules/:id?locale=` | Full lesson sections and quiz. Correct answers are stripped unless `?include_answers=1` |
| POST | `/api/v1/training/modules/:id/grade?locale=` | Body `{"answers": [1, 2, 0]}`. Returns `score`, `correct`, `total`, `passed` (70% pass mark) and per-question `details` in the requested locale |
| GET | `/api/v1/tenants/:id/entitlements` | Effective plan after pack expiry and seat resolution |
| GET | `/api/v1/tenants/:id/literacy-evidence?locale=` | Article 4 evidence report data: per user, completed modules with content version, score and date |
| ANY | `/rest/{table}[/{id}]` | Generic CRUD with `?column=value`, `sort_by`, `order`, `limit`, `offset` |
| POST | `/query` | `{"query": "SELECT ...", "params": []}` raw parameterised SQL |

Example:

```bash
curl https://<worker>/api/v1/deadlines | jq '.next_deadline'

curl -H "Authorization: Bearer $SECRET" \
     -H "Content-Type: application/json" \
     -d '{"answers":[1,1,1,0]}' \
     https://<worker>/api/v1/training/modules/mod_update_2026/grade
```

## Content model

| Table | Source file | Purpose |
|-------|-------------|---------|
| `compliance_deadlines` | `content/deadlines.json` | Every application date in the amended Act, with `status` (`confirmed`, `backstop`, `conditional`), the amending act, and the pre-amendment date |
| `regulatory_updates` | `content/regulatory-updates.json` | Dated feed of legislation, guidance, standards, enforcement and codes of practice, each with sources |
| `training_modules` | `content/training-modules.json` | 13 Article 4 training modules. `content` holds `sections` and `quiz` (with answers); `content_version` is bumped on every revision |
| `training_module_translations`, `checklist_translations` | `content/translations/sv.json` | Swedish overlays. Quiz answer indexes must match the English base; the generator checks this |
| `checklists` | `content/checklists.json` | Article 50 transparency readiness and Article 4 evidence checklists, with guidance and evidence hints per item |
| `plans` | `content/plans.json` | Plans and pay-once packs with prices, seat rules and entitlements. See `docs/PRICING.md` |
| `checklist_progress` | written by the Flask app | Per-tenant tick state for checklist items |

The module JSON keeps the same shape the Flask app's `training.py` uses (`id`, `title`, `description`, `category`, `tier_required`, `duration_min`, `order_index`, `content.sections`, `content.quiz`), so it can be loaded there directly. `docs/COMPYAI_CONTENT_SYNC.md` describes the matching Flask changes, shipped as `docs/compyai/commercial-model.patch`.

### Editing content

1. Edit the JSON under `content/`. Bump `content_version` on any module whose sections or quiz changed, and update `content/translations/sv.json` to match.
2. `npm run content:build`. The generator rejects duplicate ids, bad dates, unknown categories or tiers, quiz answers out of range, non-HTTPS sources, translations whose section or quiz shape differs from the base, and plans that reference unknown checklists.
3. `npm run db:setup:local && npm run dev && npm run test:smoke`.
4. Commit the JSON and the regenerated `seeds/content.sql` together.
5. `npm run db:seed:remote` after merge.

Application tables (`users`, `tenants`, `ai_systems`, `risk_assessments`, `documents`, `training_progress`, `team_invitations`, `audit_log`) are owned by the Flask application. The only change these migrations make to them is the plan columns migration `0003` adds to `tenants`.

## Security notes

- Table and column names in `/rest/*` are reduced to `[A-Za-z0-9_]` before being interpolated; values are always bound parameters.
- The bearer token is compared with a constant-time comparison.
- `/query` executes arbitrary SQL for the holder of the secret. Keep the secret server-side; never ship it to a browser.
- Public endpoints expose only regulatory content and module metadata, never lesson content or quiz answers.

## License

MIT, see `LICENSE`.
