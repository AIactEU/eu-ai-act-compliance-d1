# eu-ai-act-compliance-d1

Cloudflare Worker that fronts the **Comply AI** D1 database. It serves two things:

1. **Regulatory content API** (`/api/v1/*`): the EU AI Act compliance calendar, a regulatory-update feed, and the Article 4 AI-literacy training library, all stored in D1 and kept current with the Act as amended by the Digital Omnibus on AI (Regulation (EU) 2026/1744).
2. **Generic data access** (`/rest/*`, `/query`): authenticated CRUD and raw SQL against every table, used by the Comply AI Flask application.

Content is authored as JSON under `content/`, validated and compiled into a SQL seed, and deployed with D1 migrations. See `docs/REGULATORY_CHANGELOG.md` for what changed in the regulation and when, with sources.

## Stack

- Cloudflare Workers + Hono
- Cloudflare D1 (`eu-ai-act-compliance`, binding `DB`)
- Cloudflare Secrets Store for the API bearer token (binding `SECRET`); `API_SECRET` var as local fallback
- TypeScript, Wrangler 4

## Quick start (local)

```bash
npm install
npm run content:build        # content/*.json -> migrations/0002_seed_content.sql (validates content)
npm run db:migrate:local     # applies 0001 schema + 0002 seed to the local D1
npm run dev                  # http://localhost:8787 with API_SECRET=dev-secret
npm run test:smoke           # in a second terminal: 29 end-to-end checks
npm run typecheck
```

## Deploy

```bash
npm run content:build
npm run db:migrate:remote    # first time: creates tables and seeds content
npm run deploy
```

When only content changes (a new deadline, a new update, a revised module):

```bash
npm run content:build
npm run db:seed:remote       # re-applies the seed; INSERT OR REPLACE makes it idempotent
```

The remote secret is set once in the Cloudflare dashboard (Secrets Store, secret `eu-ai-act-compliance-secret`) and read by the worker at first request.

## API

All responses are JSON. Public endpoints send `Cache-Control: public, max-age=300, s-maxage=900`.

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness and D1 reachability |
| GET | `/api/v1/deadlines` | Compliance calendar, oldest first, with `days_remaining`, `phase` and `next_deadline` |
| GET | `/api/v1/regulatory-updates?limit=20&category=` | Update feed, newest first. Categories: `legislation`, `guidance`, `standards`, `enforcement`, `code_of_practice` |
| GET | `/api/v1/training/modules?tier=free` | Module catalogue (no lesson content). `locked` is computed from `tier` (`free`, `starter`, `pro`, `enterprise`) |

### Authenticated (`Authorization: Bearer <secret>`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/training/modules/:id` | Full lesson sections and quiz. Correct answers are stripped unless `?include_answers=1` |
| POST | `/api/v1/training/modules/:id/grade` | Body `{"answers": [1, 2, 0]}`. Returns `score`, `correct`, `total`, `passed` (70% pass mark) and per-question `details` |
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
| `training_modules` | `content/training-modules.json` | 12 Article 4 training modules. `content` holds `sections` and `quiz` (with answers); `content_version` is bumped on every revision |

The module JSON keeps the same shape the Flask app's `training.py` uses (`id`, `title`, `description`, `category`, `tier_required`, `duration_min`, `order_index`, `content.sections`, `content.quiz`), so it can be loaded there directly. `docs/COMPYAI_CONTENT_SYNC.md` lists the lines in the Flask app and templates that still carry the pre-Omnibus dates.

### Editing content

1. Edit the JSON under `content/`. Bump `content_version` on any module whose sections or quiz changed.
2. `npm run content:build`. The generator rejects duplicate ids, bad dates, unknown categories or tiers, quiz answers out of range, and non-HTTPS sources.
3. `npm run db:migrate:local && npm run dev && npm run test:smoke`.
4. Commit the JSON and the regenerated `migrations/0002_seed_content.sql` together.
5. `npm run db:seed:remote` after merge.

Application tables (`users`, `tenants`, `ai_systems`, `risk_assessments`, `documents`, `training_progress`, `team_invitations`, `audit_log`) are owned by the Flask application and are not touched by these migrations.

## Security notes

- Table and column names in `/rest/*` are reduced to `[A-Za-z0-9_]` before being interpolated; values are always bound parameters.
- The bearer token is compared with a constant-time comparison.
- `/query` executes arbitrary SQL for the holder of the secret. Keep the secret server-side; never ship it to a browser.
- Public endpoints expose only regulatory content and module metadata, never lesson content or quiz answers.

## License

MIT, see `LICENSE`.
