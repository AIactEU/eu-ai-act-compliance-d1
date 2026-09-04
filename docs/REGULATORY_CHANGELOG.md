# EU AI Act regulatory changelog

State of play as of 4 September 2026. This file is the human-readable companion to
`content/deadlines.json` and `content/regulatory-updates.json`. Update all three together.

## The amended application calendar

| Date | What applies | Status |
|------|--------------|--------|
| 1 Aug 2024 | Regulation (EU) 2024/1689 in force | done |
| 2 Feb 2025 | Article 5 prohibitions; Article 4 AI literacy | done |
| 2 Aug 2025 | Chapter V GPAI obligations; national authorities; penalty framework | done |
| 27 Jul 2026 | Regulation (EU) 2026/1744 (Digital Omnibus on AI) in force | done |
| 2 Aug 2026 | Article 50 transparency; AI Office and national enforcement powers; Commission fines on GPAI providers | done |
| 2 Dec 2026 | End of marking grace period for generative systems already on the market before 2 Aug 2026 | upcoming |
| 2 Feb 2027 | Transparency Code signatories: watermark-detection interoperability | upcoming |
| 2 Aug 2027 | Legacy GPAI models (pre 2 Aug 2025) must comply | upcoming |
| 2 Dec 2027 | Annex III high-risk backstop (6 months after Commission standards decision) | backstop |
| 2 Aug 2028 | Annex I embedded high-risk backstop (12 months after that decision) | backstop |

## What the Digital Omnibus on AI changed

Legislative path: Commission proposal 19 Nov 2025; provisional agreement 7 May 2026; Parliament plenary
16 Jun 2026 (423 for, 57 against, 174 abstentions); Council adoption 29 Jun 2026; Official Journal
24 Jul 2026; entry into force 27 Jul 2026.

- **High-risk deferral with stop-the-clock.** Annex III obligations apply six months after a Commission
  decision confirming that harmonised standards, common specifications and guidance are available, and
  no later than 2 Dec 2027. Annex I obligations apply twelve months after that decision, no later than
  2 Aug 2028. The substantive requirements (Articles 9 to 17, 26, 27, 43, 49, 72, 73) are unchanged.
- **Article 50 kept its date** (2 Aug 2026), with a four-month grace period to 2 Dec 2026 for the
  Article 50(2) machine-readable marking duty on generative systems already on the market.
- **Article 4 softened.** Providers and deployers must take measures to support AI literacy; they do not
  have to guarantee a level of literacy. Commission and Member States support and publish examples.
- **New prohibition.** AI practices for generating non-consensual sexual or intimate imagery and child
  sexual abuse material ("nudification").
- **Article 6(3) registration kept**, in simplified form. The Commission's proposal to drop it was rejected.
- **Small mid-caps** get SME-style relief: simplified technical documentation, sandbox priority, lower
  penalty caps.
- **Article 10(5) bias-detection basis** for special-category data extended to providers and deployers of
  all AI systems, under a strict-necessity test with safeguards.
- **AI Office exclusive supervision** of AI systems built on a GPAI model from the same provider or group,
  and of AI systems integrated into DSA very large online platforms and search engines.

## Guidance, codes and standards

- **GPAI Code of Practice** (final, 10 Jul 2025): Transparency, Copyright, Safety and Security chapters.
  Commission GPAI guidelines and the mandatory training-content summary template followed in July 2025.
- **Transparency Code of Practice** on marking and labelling AI-generated content, confirmed adequate by
  the Commission in July 2026, alongside final Article 50 guidelines. Pre-2 Aug 2026 content need not be
  marked retroactively. Signatories commit to detection interoperability by 2 Feb 2027.
- **EN 18286:2026** (AI quality management system for EU AI Act purposes, Article 17) approved by CEN and
  CENELEC on 12 Jul 2026. First JTC 21 AI Act standard to reach final approval. Not yet cited in the
  Official Journal, so no presumption of conformity yet.
- Still in draft: prEN 18228 (risk management), prEN 18229 (trustworthiness framework: logging,
  transparency, human oversight), prEN 18282 (cybersecurity for AI), prEN 18284 (data quality and governance).

## Enforcement

- From 2 Aug 2026 the AI Office and national market-surveillance authorities exercise their powers.
- Commission fines on GPAI providers: up to EUR 15 million or 3% of worldwide turnover, covering breaches
  since 2 Aug 2025.
- Penalty ceilings: EUR 35 million or 7% (prohibited practices); EUR 15 million or 3% (most obligations);
  EUR 7.5 million or 1% (incorrect information). SMEs and small mid-caps pay the lower figure.

## Corrections made to the earlier course content

The previous training text (Comply AI `training.py`) contained these errors, now fixed in
`content/training-modules.json`:

- "2 August 2026: full high-risk requirements apply" and "2 August 2027" for Annex I: replaced with the
  amended dates and the Commission-decision trigger.
- Serious incidents "within 72 hours": Article 73 sets 15 days (2 days for widespread infringement or
  critical-infrastructure disruption, 10 days for death).
- Log retention "system lifetime plus 6 months": Articles 19 and 26(6) require at least six months.
- Article 4 described as an obligation to ensure literacy for every person: now measures-based.
- Article 6(3) described as a self-assessment with registration: still true, now via simplified registration.
- Emotion recognition in the workplace was not mentioned as prohibited; it is (Article 5(1)(f)).

## Sources

Primary and secondary sources used for this update. Law-firm and EU sites were verified via search
snippets where the pages themselves were not reachable from the build environment.

- Regulation (EU) 2026/1744, EUR-Lex: https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng
- Commission, AI Omnibus enters into force: https://digital-strategy.ec.europa.eu/en/news/ai-omnibus-enters-force
- Commission press release IP/26/1714 (2 Aug 2026 enforcement and transparency): https://ec.europa.eu/commission/presscorner/detail/en/ip_26_1714
- Council press release, 7 May 2026 provisional agreement: https://www.consilium.europa.eu/en/press/press-releases/2026/05/07/artificial-intelligence-council-and-parliament-agree-to-simplify-and-streamline-rules/
- European Parliament Legislative Train, Digital Omnibus on AI: https://www.europarl.europa.eu/legislative-train/package-digital-package/file-digital-omnibus-on-ai
- White & Case, EU AI Omnibus enters into force: https://www.whitecase.com/insight-alert/eu-ai-omnibus-enters-force-amending-ai-act
- Gibson Dunn, Omnibus agreement, postponed deadlines and other key changes: https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/
- Lewis Silkin, The Digital Omnibus on AI enters into force today: https://www.lewissilkin.com/en/insights/2026/07/27/the-digital-omnibus-on-ai-enters-into-force-today-102nedo
- Cloud Security Alliance research note, high-risk deadline deferred not cancelled: https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-high-risk-deadline-omnibus-20260/
- Sofia Globe, Parliament approves AI Act amendments and nudifier ban (16 Jun 2026): https://sofiaglobe.com/2026/06/16/european-parliament-approves-ai-act-amendments-nudifier-ban/
- Faegre Drinker, Commission confirms Transparency Code of Practice and final Article 50 guidelines: https://www.faegredrinker.com/en/insights/publications/2026/7/eu-ai-act-commission-confirms-transparency-code-of-practice-as-adequate-and-publishes-final-version-of-its-guidelines-on-transparency-obligations
- Usercentrics, Article 50 grace period to 2 Dec 2026: https://usercentrics.com/knowledge-hub/eu-ai-act-high-risk-delay-article-50-transparency-consent/
- CEN-CENELEC, EN 18286 in the spotlight: https://www.cencenelec.eu/news-events/news/2026/en-in-the-spotlight/2026-07-30-ai-quality-management/
- BSI press release on EN 18286:2026: https://www.bsigroup.com/en-GB/insights-and-media/media-centre/press-releases/2026/july/en-18286-provides-a-framework-for-ai-quality-management-under-the-eu-ai-act/
- Latham & Watkins, GPAI obligations in force and final Code of Practice: https://www.lw.com/en/insights/eu-ai-act-gpai-model-obligations-in-force-and-final-gpai-code-of-practice-in-place
- Paul, Weiss, GPAI guidelines and training-data template: https://www.paulweiss.com/insights/client-memos/eu-commission-publishes-guidelines-on-general-purpose-ai-obligations-as-well-as-training-data-disclosure-template-further-clarity-as-the-countdown-to-enforcement-begins
- Al Jazeera, what came into force on 2 Aug 2026 and what didn't: https://www.aljazeera.com/news/2026/8/6/what-came-into-force-with-the-eus-ai-act-this-week-and-what-didnt
