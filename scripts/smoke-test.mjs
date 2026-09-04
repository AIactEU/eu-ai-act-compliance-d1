#!/usr/bin/env node
/**
 * End-to-end smoke test against a running worker with a seeded local D1.
 *
 *   npm run db:setup:local
 *   npm run dev            # in another terminal (binds API_SECRET=dev-secret)
 *   npm run test:smoke
 *
 * Environment: BASE_URL (default http://localhost:8787), API_SECRET (default dev-secret).
 * The test inserts and removes two tenants prefixed `smoke_` through /query.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const SECRET = process.env.API_SECRET ?? "dev-secret";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const auth = { Authorization: `Bearer ${SECRET}` };
const get = (path, headers = {}) => fetch(`${BASE}${path}`, { headers });
const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const sql = (query, params = []) => post("/query", { query, params }, auth);

// health
{
  const r = await get("/health");
  const body = await r.json();
  check("GET /health is 200 with db reachable", r.status === 200 && body.db === "reachable", JSON.stringify(body));
}

// deadlines (public)
{
  const r = await get("/api/v1/deadlines");
  const body = await r.json();
  const annexIII = body.deadlines?.find((d) => d.id === "dl_2027_12_02_annex_iii_high_risk");
  check("GET /api/v1/deadlines is 200", r.status === 200);
  check("deadlines: at least 10 rows", (body.deadlines?.length ?? 0) >= 10, `${body.deadlines?.length}`);
  check("deadlines: Annex III backstop is 2027-12-02 with original 2026-08-02", annexIII?.effective_date === "2027-12-02" && annexIII?.original_date === "2026-08-02");
  check("deadlines: next_deadline is in the future", body.next_deadline && body.next_deadline.days_remaining >= 0, body.next_deadline?.id);
  check("deadlines: Cache-Control set", (r.headers.get("cache-control") ?? "").includes("max-age"));

  const ics = await get("/api/v1/deadlines.ics");
  const text = await ics.text();
  check("GET /api/v1/deadlines.ics is text/calendar", ics.status === 200 && (ics.headers.get("content-type") ?? "").includes("text/calendar"));
  check("ics: valid envelope with one VEVENT per deadline", text.startsWith("BEGIN:VCALENDAR") && (text.match(/BEGIN:VEVENT/g) ?? []).length === body.deadlines.length);
  check("ics: Annex III event present", text.includes("DTSTART;VALUE=DATE:20271202"));
}

// embed widget (public)
{
  const r = await get("/embed/deadlines?brand=Smoke%20Advisors&accent=%23ff0000&limit=3");
  const html = await r.text();
  check("GET /embed/deadlines is 200 text/html", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/html"));
  check("embed: brand and accent applied", html.includes("Smoke Advisors") && html.includes("--accent:#ff0000"));
  check("embed: limited to 3 rows", (html.match(/class="row"/g) ?? []).length === 3);
  const bad = await (await get("/embed/deadlines?brand=%3Cscript%3Ealert(1)%3C/script%3E&accent=javascript:x")).text();
  check("embed: escapes brand and rejects bad accent", !bad.includes("<script>") && bad.includes("--accent:#0052cc"));
}

// regulatory updates (public)
{
  const r = await get("/api/v1/regulatory-updates?limit=3");
  const body = await r.json();
  check("GET /api/v1/regulatory-updates?limit=3 returns 3", r.status === 200 && body.updates?.length === 3, `${body.updates?.length}`);
  check("updates: sorted newest first", body.updates?.[0]?.published_on >= body.updates?.[1]?.published_on);
  check("updates: sources parsed to array", Array.isArray(body.updates?.[0]?.sources));
  const r2 = await get("/api/v1/regulatory-updates?category=standards");
  const b2 = await r2.json();
  check("updates: category filter works", b2.updates?.every((u) => u.category === "standards") && b2.updates.length >= 1);
}

// plans (public + auth)
{
  const r = await get("/api/v1/plans");
  const body = await r.json();
  check("GET /api/v1/plans is 200", r.status === 200);
  check("plans: 7 active plans, legacy hidden", body.plans?.length === 7 && !body.plans.some((p) => p.id.startsWith("legacy_")), `${body.plans?.length}`);
  check("plans: ordered by position", body.plans?.every((p, i, a) => i === 0 || a[i - 1].position <= p.position));
  const team = body.plans?.find((p) => p.id === "team");
  const pack = body.plans?.find((p) => p.id === "pack_literacy");
  check("plans: team is EUR 10 per seat, min 3", team?.billing === "per_seat_monthly" && team?.price_eur === 10 && team?.seat_min === 3);
  check("plans: literacy pack is one-time EUR 490 for 12 months, 25 seats", pack?.billing === "one_time" && pack?.price_eur === 490 && pack?.term_months === 12 && pack?.entitlements?.seats === 25);
  check("plans: packs listed", Array.isArray(body.packs) && body.packs.length === 3);
  const r401 = await get("/api/v1/plans?include_inactive=1");
  check("plans: include_inactive requires auth", r401.status === 401);
  const rAll = await (await get("/api/v1/plans?include_inactive=1", auth)).json();
  check("plans: include_inactive returns legacy plans", rAll.plans?.length === 9 && rAll.plans.some((p) => p.id === "legacy_pro"));
}

// checklists
{
  const r = await get("/api/v1/checklists");
  const body = await r.json();
  check("GET /api/v1/checklists is 200 with 2 checklists", r.status === 200 && body.checklists?.length === 2, `${body.checklists?.length}`);
  check("checklists: catalogue has item counts and no sections", body.checklists?.every((c) => c.item_count > 0 && c.sections === undefined));
  const sv = await (await get("/api/v1/checklists?locale=sv")).json();
  check("checklists: Swedish titles via ?locale=sv", sv.checklists?.some((c) => c.title.includes("Artikel 50")) && sv.locale === "sv");
  const r401 = await get("/api/v1/checklists/chk_article50_readiness");
  check("checklist content requires auth", r401.status === 401);
  const full = await (await get("/api/v1/checklists/chk_article50_readiness", auth)).json();
  check("checklist content: 6 sections with guidance", full.sections?.length === 6 && full.sections[0].items[0].guidance?.length > 0);
  const fullSv = await (await get("/api/v1/checklists/chk_article50_readiness", { ...auth, "Accept-Language": "sv-SE,sv;q=0.9" })).json();
  check("checklist content: Accept-Language sv gives Swedish with same item ids", fullSv.locale === "sv" && fullSv.sections[0].items[0].id === full.sections[0].items[0].id && fullSv.title !== full.title);
  const r404 = await get("/api/v1/checklists/nope", auth);
  check("unknown checklist is 404", r404.status === 404);
}

// training catalogue (public)
{
  const r = await get("/api/v1/training/modules?tier=starter");
  const body = await r.json();
  check("GET /api/v1/training/modules is 200", r.status === 200);
  check("modules: 13 published modules", body.modules?.length === 13, `${body.modules?.length}`);
  const free = body.modules?.find((m) => m.id === "mod_update_2026");
  const a50 = body.modules?.find((m) => m.id === "mod_article50_readiness");
  const pro = body.modules?.find((m) => m.id === "mod_gpai_01");
  check("modules: free module unlocked for starter", free && free.locked === false);
  check("modules: Article 50 module is starter and unlocked", a50 && a50.tier_required === "starter" && a50.locked === false && a50.order_index === 5);
  check("modules: pro module locked for starter", pro && pro.locked === true);
  check("modules: catalogue does not leak content", body.modules?.every((m) => m.content === undefined));
  check("modules: available_locales lists sv for translated modules", free?.available_locales?.includes("sv") && !pro?.available_locales?.includes("sv"));
  const sv = await (await get("/api/v1/training/modules?tier=enterprise&locale=sv")).json();
  const svFree = sv.modules?.find((m) => m.id === "mod_foundation_01");
  const svPro = sv.modules?.find((m) => m.id === "mod_gpai_01");
  check("modules: sv overlay on translated, en fallback otherwise", svFree?.title === "Vad är EU:s AI-förordning?" && svFree.locale === "sv" && svPro?.locale === "en");
  check("modules: nothing locked for enterprise", sv.modules?.every((m) => m.locked === false));
}

// module content (auth)
{
  const r401 = await get("/api/v1/training/modules/mod_foundation_01");
  check("module content without token is 401", r401.status === 401);
  const rBad = await get("/api/v1/training/modules/mod_foundation_01", { Authorization: "Bearer wrong" });
  check("module content with wrong token is 401", rBad.status === 401);

  const r = await get("/api/v1/training/modules/mod_foundation_01", auth);
  const body = await r.json();
  check("module content with token is 200", r.status === 200);
  check("module content: quiz has no answers by default", body.content?.quiz?.every((q) => q.correct === undefined && q.explanation === undefined));
  check("module content: sections mention December 2027", JSON.stringify(body.content?.sections ?? []).includes("2 December 2027"));

  const rA = await get("/api/v1/training/modules/mod_foundation_01?include_answers=1", auth);
  const bA = await rA.json();
  check("module content: include_answers=1 returns correct indexes", bA.content?.quiz?.every((q) => Number.isInteger(q.correct)));

  const rSv = await (await get("/api/v1/training/modules/mod_article50_readiness?locale=sv", auth)).json();
  check("module content: Swedish Article 50 module", rSv.locale === "sv" && rSv.content?.sections?.[0]?.title.startsWith("Varför artikel 50"));

  const r404 = await get("/api/v1/training/modules/does_not_exist", auth);
  check("unknown module is 404", r404.status === 404);
}

// grading (auth)
{
  const answers = await (await get("/api/v1/training/modules/mod_update_2026?include_answers=1", auth)).json();
  const correct = answers.content.quiz.map((q) => q.correct);

  const bAll = await (await post("/api/v1/training/modules/mod_update_2026/grade", { answers: correct }, auth)).json();
  check("grade: all correct scores 100 and passes", bAll.score === 100 && bAll.passed === true, JSON.stringify({ score: bAll.score, passed: bAll.passed }));

  const wrong = correct.map((c, i) => (i === 0 ? c : (c + 1) % 4));
  const bSome = await (await post("/api/v1/training/modules/mod_update_2026/grade", { answers: wrong }, auth)).json();
  check("grade: one of four correct scores 25 and fails", bSome.score === 25 && bSome.passed === false, `${bSome.score}`);

  const bSv = await (await post("/api/v1/training/modules/mod_update_2026/grade?locale=sv", { answers: correct }, auth)).json();
  check("grade: sv locale keeps score and returns Swedish explanations", bSv.score === 100 && bSv.locale === "sv" && /trädde i kraft/.test(bSv.details[0].explanation));

  const rInvalid = await post("/api/v1/training/modules/mod_update_2026/grade", { answers: "nope" }, auth);
  check("grade: invalid body is 400", rInvalid.status === 400);
  const rNoAuth = await post("/api/v1/training/modules/mod_update_2026/grade", { answers: correct });
  check("grade: no token is 401", rNoAuth.status === 401);
}

// tenants: entitlements and evidence (auth)
{
  const future = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 1 * 86_400_000).toISOString();
  const cleanup = async () => {
    await sql("DELETE FROM training_progress WHERE tenant_id LIKE 'smoke_%'");
    await sql("DELETE FROM users WHERE tenant_id LIKE 'smoke_%'");
    await sql("DELETE FROM tenants WHERE id LIKE 'smoke_%'");
  };
  await cleanup();
  await sql("INSERT INTO tenants (id, name, tier, plan, seats, plan_expires_at) VALUES ('smoke_pack', 'Smoke Pack AB', 'pro', 'pack_literacy', NULL, ?)", [future]);
  await sql("INSERT INTO tenants (id, name, tier, plan, seats, plan_expires_at) VALUES ('smoke_expired', 'Smoke Expired AB', 'free', 'pack_transparency', NULL, ?)", [past]);
  await sql("INSERT INTO tenants (id, name, tier, plan, seats) VALUES ('smoke_team', 'Smoke Team AB', 'pro', 'team', 7)");
  await sql("INSERT INTO users (id, tenant_id, email, name, role) VALUES ('smoke_u1', 'smoke_pack', 'anna@example.com', 'Anna', 'admin')");
  await sql("INSERT INTO users (id, tenant_id, email, name, role) VALUES ('smoke_u2', 'smoke_pack', 'bo@example.com', 'Bo', 'member')");
  await sql("INSERT INTO training_progress (id, user_id, tenant_id, module_id, status, score, completed_at) VALUES ('smoke_p1', 'smoke_u1', 'smoke_pack', 'mod_foundation_01', 'completed', 100, ?)", [past]);
  await sql("INSERT INTO training_progress (id, user_id, tenant_id, module_id, status, score) VALUES ('smoke_p2', 'smoke_u2', 'smoke_pack', 'mod_update_2026', 'in_progress', NULL)");

  const r401 = await get("/api/v1/tenants/smoke_pack/entitlements");
  check("entitlements require auth", r401.status === 401);
  const pack = await (await get("/api/v1/tenants/smoke_pack/entitlements", auth)).json();
  check("entitlements: active pack resolves to pro training, 25 seats, not expired", pack.effective_plan === "pack_literacy" && pack.training_tier === "pro" && pack.entitlements?.seats === 25 && pack.expired === false, JSON.stringify({ plan: pack.effective_plan, tier: pack.training_tier, seats: pack.entitlements?.seats }));
  const expired = await (await get("/api/v1/tenants/smoke_expired/entitlements", auth)).json();
  check("entitlements: expired pack falls back to free", expired.effective_plan === "free" && expired.expired === true && expired.purchased_plan === "pack_transparency");
  const team = await (await get("/api/v1/tenants/smoke_team/entitlements", auth)).json();
  check("entitlements: per-seat plan takes tenant seat count", team.effective_plan === "team" && team.entitlements?.seats === 7 && team.entitlements?.evidence_report === true);
  const r404 = await get("/api/v1/tenants/nope/entitlements", auth);
  check("entitlements: unknown tenant is 404", r404.status === 404);

  const ev = await (await get("/api/v1/tenants/smoke_pack/literacy-evidence", auth)).json();
  const anna = ev.users?.find((u) => u.user_id === "smoke_u1");
  check("evidence: report shape", ev.report === "article4_literacy_evidence" && ev.summary?.users === 2 && ev.summary?.modules_available === 13, JSON.stringify(ev.summary));
  check("evidence: completed module carries title, version and score", anna?.completed?.[0]?.module_id === "mod_foundation_01" && anna.completed[0].content_version === "2026.09" && anna.completed[0].score === 100);
  check("evidence: missing list excludes completed", anna?.missing?.length === 12 && !anna.missing.includes("mod_foundation_01"));
  const evSv = await (await get("/api/v1/tenants/smoke_pack/literacy-evidence?locale=sv", auth)).json();
  check("evidence: Swedish module titles where translated", evSv.modules?.find((m) => m.id === "mod_foundation_01")?.title === "Vad är EU:s AI-förordning?");

  await cleanup();
  const gone = await (await get("/api/v1/tenants/smoke_pack/entitlements", auth)).json();
  check("smoke tenants cleaned up", gone.error === "Tenant not found");
}

// legacy generic REST still works
{
  const r = await get("/rest/training_modules?limit=2&sort_by=order_index&order=asc", auth);
  const body = await r.json();
  check("GET /rest/training_modules still works", r.status === 200 && body.results?.length === 2 && body.results[0].id === "mod_foundation_01");
  const r401 = await get("/rest/training_modules");
  check("GET /rest without token is 401", r401.status === 401);
}

console.log(failures === 0 ? "\nAll smoke tests passed." : `\n${failures} smoke test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
