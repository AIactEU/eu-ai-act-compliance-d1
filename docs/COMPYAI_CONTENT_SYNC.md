# Syncing the Comply AI Flask app with this repository

The Flask application in `AIactEU/CompyAI` (`complyAI/`) reads training content, plans and
checklists from the D1 tables this repository seeds. The matching application changes are prepared
as a patch in `docs/compyai/commercial-model.patch`, produced against CompyAI commit `8a78834`.

## Apply the patch

```bash
cd CompyAI
git checkout -b commercial-model-2026
git apply --index /path/to/eu-ai-act-compliance-d1/docs/compyai/commercial-model.patch
git commit -m "Commercial model 2026: plans, packs, checklists, D1-backed training"
```

Deploy order matters:

1. In this repository: `npm run db:migrate:remote && npm run db:seed:remote && npm run deploy`.
   Migration `0003` adds the plan columns to `tenants` and maps existing `tier` values to
   `legacy_starter` / `legacy_pro`, so current subscribers keep what they pay for.
2. Create the Stripe products and prices listed in `docs/PRICING.md` and set the env vars on Render.
3. Deploy the patched Flask app.

## What the patch changes

`complyAI/plans.py` (new)
- Loads the `plans` table, caches it, resolves effective entitlements per tenant (pack expiry,
  per-seat counts, legacy tier mapping), exposes `has_feature`, `checklist_access`, `limit_for`.

`complyAI/training.py` (rewritten)
- Module content comes from `training_modules` and `training_module_translations` with a
  five-minute cache. Same function names as before, plus a `locale` argument. Certificates are
  bilingual and carry the content version.

`complyAI/app.py`
- `TIERS` removed. Limits, gating and the training tier derive from `plans.resolve_entitlements`.
- `GET /api/billing/plans` and `POST /api/billing/checkout` (Stripe Checkout, subscription mode for
  Team and Business, payment mode for the three packs, seats as adjustable quantity).
- Webhook handles `checkout.session.completed` for packs (sets `plan`, `seats`, `plan_expires_at`),
  subscription created/updated (plan and seat quantity), and deletion (falls back to Free unless an
  unexpired pack remains). Other products on the same Stripe account are ignored as before.
- `GET /api/subscription/status` now returns the resolved plan alongside the Stripe status.
- Training routes accept `?locale=`, fall back to the tenant's `locale`, then `Accept-Language`.
- `GET /api/checklists`, `GET /api/checklists/:id`, `PUT /api/checklists/:id/items/:item_id`.
- `GET /api/training/evidence-report`: printable Article 4 evidence report.
- Certificates, evidence report and audit trail are gated on plan features, not tier names.
- `PUT /api/tenant` accepts `locale` (`en` or `sv`).

`complyAI/templates/dashboard.html`
- Pricing page rendered from `/api/billing/plans` (subscriptions and a pay-once row); the hard-coded
  Stripe buy buttons are gone. Current-plan panel shows packs with their expiry.
- New Checklists page and modal with tick-to-save items, guidance and evidence hints.
- Training page gets a language switch and an Article 4 evidence report button.

`complyAI/templates/login.html`
- Urgency banner and hero updated to the amended timeline (Article 50 live since 2 August 2026,
  high-risk by 2 December 2027).
- Fifth feature card for Article 50 readiness; module count 13.
- Pricing section: Free, Team (per seat), Business, plus three pay-once packs.
- Penalties copy corrected; footer year.

## Verified

`python3 -m py_compile` on all three modules, unit checks of `plans.py` and `training.py` against the
content JSON, and a Flask test-client run against an in-memory SQLite loaded with this repository's
migrations and seed (training list and content in both locales, quiz completion, plan gating,
checkout session creation, pack and subscription webhooks, seat limits, checklist ticking, evidence
report, legacy tenant mapping). Stripe and Auth0 were stubbed; a live checkout has not been run.

## Housekeeping still open in CompyAI

- `complyAI/.env` is committed with live-looking secrets (Auth0, Stripe, Cloudflare). Rotate them and
  remove the file from the repository before going to market.
- Seven `login - kopia (n).html` and two `app - kopia (n).py` backup copies are committed. Delete them.
- `templates/dashboard.html` still embeds the Stripe publishable key in one place after the patch
  (harmless, but it can go now that Checkout Sessions are used).
