# Syncing the Comply AI Flask app with this content

The Flask application in the `AIactEU/CompyAI` repository (`complyAI/`) still carries the
pre-Omnibus timeline in code and templates. This repository now holds the corrected content in D1
and in `content/training-modules.json`. The list below is what needs to change on the Flask side.
It was produced against CompyAI commit `8a78834` and is not applied there by this branch.

## Option A (recommended): load modules from D1

Replace the hard-coded `TRAINING_MODULES` list in `complyAI/training.py` with a loader that reads
`training_modules` from D1 through the existing `d1_query` helper. The table columns map one-to-one
onto the dictionary keys the app already uses; `content` is JSON text with `sections` and `quiz`.

```python
def _load_modules():
    rows = d1_query(
        "SELECT id, title, description, category, tier_required, duration_min, "
        "order_index, content, content_version FROM training_modules "
        "WHERE is_published = 1 ORDER BY order_index"
    )
    for r in rows:
        r["content"] = json.loads(r["content"])
    return rows
```

`get_modules_for_tier`, `get_module_content` and `grade_quiz` keep working unchanged once
`TRAINING_MODULES` comes from this loader (cache it per process; the content changes rarely).
Alternatively call this worker: `GET /api/v1/training/modules/:id?include_answers=1` and
`POST /api/v1/training/modules/:id/grade` with the shared bearer secret.

## Option B: drop in the JSON

Copy `content/training-modules.json` into the Flask project and set
`TRAINING_MODULES = json.load(open("training_modules.json"))`. Same shape, no schema change.

## Stale text to fix in CompyAI regardless of option

`complyAI/training.py`

- Lines 62-65: "2 August 2026 - Full high-risk system requirements apply" and "2 August 2027" for
  regulated products. Now 2 December 2027 and 2 August 2028 at the latest, with the Commission-decision trigger.
- Line 6 docstring: fine, but add that content reflects Regulation (EU) 2026/1744.
- Foundation module 3, "Incident Reporting": "within 72 hours" is wrong. Article 73: 15 days,
  2 days for widespread infringement or critical-infrastructure disruption, 10 days for death.
- Foundation module 3, "Obligations for All AI Users (Article 4)": reword to the measures-based
  obligation introduced in 2026.
- Foundation module 3, "Transparency Obligations (Article 50)": add "in force since 2 August 2026" and
  the 2 December 2026 grace period for legacy generative systems.
- Technical module 1, "Article 6(3)": registration retained via simplified procedure.
- Technical module 3 quiz option "Only after August 2026": change to "Only after December 2027".
- Role module (developers), "Logging Requirements": "system lifetime plus 6 months" is wrong.
  Articles 19 and 26(6): at least six months.
- Role module (HR): add the Article 5(1)(f) workplace emotion-recognition prohibition.
- New modules to add: `mod_update_2026` (free) and `mod_gpai_01` (pro). The catalogue is now 12 modules.

`complyAI/templates/login.html`

- Line 198: "High-risk system rules apply from Aug 2, 2026." Replace with, for example:
  "Transparency rules and enforcement are live since 2 August 2026. High-risk obligations follow by
  2 December 2027." This is the headline urgency banner on the landing page and is now factually wrong.
- Line 473: "or 3% of turnover for high-risk system violations" is correct but pair it with the
  EUR 15 million figure.
- Line 495: footer year "2025".

`complyAI/templates/dashboard.html`

- Line 394 and the landing-page copy "Mandatory under Article 4 since February 2, 2025" remain correct.
- Plan cards (lines 490, 513, 535) say "3 modules" and "10+ modules". With this content the counts are:
  free 2 (foundation 1 + regulatory update), starter 4, pro/enterprise 12.

`complyAI/app.py`

- `TIERS` "training" values are unchanged. If the free tier should see the two free modules,
  `get_modules_for_tier("free")` already returns them unlocked, but `TIERS["free"]["training"]` is
  `"none"`. Decide whether the free regulatory-update module is a lead magnet (set it to `"basic"`) or not.

## Housekeeping spotted in CompyAI

- `complyAI/.env` is committed with live-looking secrets (Auth0, Stripe, Cloudflare). Rotate them and
  remove the file from the repository before going to market.
- Seven `login - kopia (n).html` and two `app - kopia (n).py` backup copies are committed. Delete them.
