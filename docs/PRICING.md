# Commercial model and Stripe setup

The plan catalogue is data, not code: `content/plans.json` is seeded into the D1 `plans`
table, served by `GET /api/v1/plans`, and read by the Flask app (`plans.py`) for the pricing
page, limits and feature gating. Change a price or a limit there, run `npm run content:build`
and `npm run db:seed:remote`, and both the worker and the app pick it up within five minutes.

## The offer (September 2026)

| Plan | Price | Seats | Training | Key entitlements |
|------|-------|-------|----------|------------------|
| Free | EUR 0 | 1 | free tier (2 modules) | 2 AI systems, calendar and feed, read-only Article 4 checklist |
| Team | EUR 10 per seat per month, min 3 | per seat | pro (all 13) | certificates, evidence report, both checklists, audit trail, 10 systems, 3 docs/month |
| Business | EUR 149 per month | 25 included | pro | Team plus 50 systems, 15 docs/month, API access, priority support |
| Enterprise | custom | unlimited | enterprise | everything, custom modules, SSO |
| Article 50 Readiness Pack | EUR 290 once, 12 months | 5 | starter (5 modules incl. Article 50 audit) | Article 50 checklist with tracking, 10 systems, certificates |
| AI Literacy Evidence Pack | EUR 490 once, 12 months | 25 | pro | certificates, evidence report, Article 4 checklist, 5 systems |
| Compliance Starter Bundle | EUR 690 once, 12 months | 25 | pro | both packs, 10 systems, 2 docs/month |

`legacy_starter` (EUR 49) and `legacy_pro` (EUR 129) are kept inactive so existing subscribers keep
their entitlements. Migration `0003` maps `tenants.tier` onto them.

Why this shape:

- Training value scales with headcount, so Team is per seat. Three seats at EUR 10 undercuts the
  EUR 39 entry point of the closest self-serve competitor while still being a real price.
- The packs are the "ease the SaaS burden" option: one invoice, twelve months, no card on file. They
  also match how small companies buy compliance: a project, not a subscription.
- The Article 50 pack targets the only obligation that is live for everyone today and that most
  competitors ignore.
- Free is a genuine funnel: the two free modules are the ones people search for, and the read-only
  Article 4 checklist shows what the paid tiers unlock.

## Stripe products to create

Create one Product per paid plan and one Price each. Put the price ids into the Flask app's
environment as JSON lists (the first id is used for checkout; others are recognised on webhooks,
which lets you rotate prices without breaking existing subscriptions):

| Plan id | Env var | Stripe price |
|---------|---------|--------------|
| team | `STRIPE_TEAM_PRICE_IDS` | recurring monthly, EUR 10, per unit (quantity = seats) |
| business | `STRIPE_BUSINESS_PRICE_IDS` | recurring monthly, EUR 149 |
| enterprise | `STRIPE_ENTERPRISE_PRICE_IDS` | optional; enterprise is sold by contact |
| pack_transparency | `STRIPE_PACK_TRANSPARENCY_PRICE_IDS` | one-time, EUR 290 |
| pack_literacy | `STRIPE_PACK_LITERACY_PRICE_IDS` | one-time, EUR 490 |
| pack_bundle | `STRIPE_PACK_BUNDLE_PRICE_IDS` | one-time, EUR 690 |
| legacy_starter | `STRIPE_STARTER_PRICE_IDS` | existing EUR 49 price (keep) |
| legacy_pro | `STRIPE_PRO_PRICE_IDS` | existing EUR 129 price (keep) |

Example:

```
STRIPE_TEAM_PRICE_IDS=["price_..."]
STRIPE_PACK_LITERACY_PRICE_IDS=["price_..."]
```

Webhook events the app needs enabled on the endpoint: `checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.

Optional: set `STRIPE_AUTOMATIC_TAX=1` once Stripe Tax is enabled on the account, and Checkout
will collect VAT ids and apply tax automatically.

## How purchases flow

1. The dashboard calls `POST /api/billing/checkout` with a plan id (and seats for Team). The app
   creates a Stripe Checkout Session in `subscription` mode for plans and `payment` mode for packs,
   with the tenant id and plan id in metadata.
2. On `checkout.session.completed` for a pack, the app sets `tenants.plan`, `seats` and
   `plan_expires_at` (purchase date plus `term_months`). On subscription events it sets the plan and
   the seat quantity from the subscription item.
3. Entitlements are resolved on every request: an expired pack falls back to Free; a cancelled
   subscription falls back to Free unless an unexpired pack is still on the tenant.
4. `tenants.tier` mirrors the plan's training tier so older queries keep working.

## Things still to decide

- Annual billing for Team and Business (a second price id per plan; the app already accepts lists).
- Whether the pack renews by reminder email or by a one-click repurchase. Today it simply expires.
- Enterprise as self-serve at a fixed price versus contact-only. The plan row exists either way.
