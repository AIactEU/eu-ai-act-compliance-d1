#!/usr/bin/env node
/**
 * End-to-end smoke test against a running worker.
 *
 *   npm run db:migrate:local && npm run db:seed:local
 *   npm run dev            # in another terminal (binds API_SECRET=dev-secret)
 *   npm run test:smoke
 *
 * Environment: BASE_URL (default http://localhost:8787), API_SECRET (default dev-secret).
 */
const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const SECRET = process.env.API_SECRET ?? "dev-secret";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const get = (path, headers = {}) => fetch(`${BASE}${path}`, { headers });
const auth = { Authorization: `Bearer ${SECRET}` };

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

// training catalogue (public)
{
  const r = await get("/api/v1/training/modules?tier=starter");
  const body = await r.json();
  check("GET /api/v1/training/modules is 200", r.status === 200);
  check("modules: 12 published modules", body.modules?.length === 12, `${body.modules?.length}`);
  const free = body.modules?.find((m) => m.id === "mod_update_2026");
  const pro = body.modules?.find((m) => m.id === "mod_gpai_01");
  check("modules: free module unlocked for starter", free && free.locked === false);
  check("modules: pro module locked for starter", pro && pro.locked === true);
  check("modules: catalogue does not leak content", body.modules?.every((m) => m.content === undefined));
  const rEnt = await get("/api/v1/training/modules?tier=enterprise");
  const bEnt = await rEnt.json();
  check("modules: nothing locked for enterprise", bEnt.modules?.every((m) => m.locked === false));
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

  const r404 = await get("/api/v1/training/modules/does_not_exist", auth);
  check("unknown module is 404", r404.status === 404);
}

// grading (auth)
{
  const answers = await (await get("/api/v1/training/modules/mod_update_2026?include_answers=1", auth)).json();
  const correct = answers.content.quiz.map((q) => q.correct);

  const rAll = await fetch(`${BASE}/api/v1/training/modules/mod_update_2026/grade`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ answers: correct }),
  });
  const bAll = await rAll.json();
  check("grade: all correct scores 100 and passes", rAll.status === 200 && bAll.score === 100 && bAll.passed === true, JSON.stringify({ score: bAll.score, passed: bAll.passed }));

  const wrong = correct.map((c, i) => (i === 0 ? c : (c + 1) % 4));
  const rSome = await fetch(`${BASE}/api/v1/training/modules/mod_update_2026/grade`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ answers: wrong }),
  });
  const bSome = await rSome.json();
  check("grade: one of four correct scores 25 and fails", bSome.score === 25 && bSome.passed === false, `${bSome.score}`);

  const rInvalid = await fetch(`${BASE}/api/v1/training/modules/mod_update_2026/grade`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ answers: "nope" }),
  });
  check("grade: invalid body is 400", rInvalid.status === 400);

  const rNoAuth = await fetch(`${BASE}/api/v1/training/modules/mod_update_2026/grade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: correct }),
  });
  check("grade: no token is 401", rNoAuth.status === 401);
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
