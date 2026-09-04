#!/usr/bin/env node
/**
 * Compiles content/*.json into seeds/content.sql.
 *
 * The output uses INSERT OR REPLACE, so it is safe to re-run against a database
 * that already holds earlier versions of the rows. It is not a migration: apply
 * the schema migrations first, then execute the seed.
 *
 *   npm run content:build
 *   npm run db:migrate:local && npm run db:seed:local
 *   npm run db:seed:remote
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(join(root, "content", rel), "utf8"));

const deadlines = readJson("deadlines.json");
const updates = readJson("regulatory-updates.json");
const modules = readJson("training-modules.json");
const plans = readJson("plans.json");
const checklists = readJson("checklists.json");
const translations = [readJson("translations/sv.json")];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (msg) => {
  console.error(`content validation failed: ${msg}`);
  process.exit(1);
};

// ---- validation -----------------------------------------------------------
const seenIds = new Set();
const uniqueId = (id, kind) => {
  if (!id || typeof id !== "string") fail(`${kind} without id`);
  if (seenIds.has(id)) fail(`duplicate id ${id}`);
  seenIds.add(id);
};

for (const d of deadlines) {
  uniqueId(d.id, "deadline");
  if (!ISO_DATE.test(d.effective_date)) fail(`${d.id}: bad effective_date`);
  if (d.original_date && !ISO_DATE.test(d.original_date)) fail(`${d.id}: bad original_date`);
  if (!["confirmed", "backstop", "conditional"].includes(d.status)) fail(`${d.id}: bad status`);
  if (!Array.isArray(d.applies_to)) fail(`${d.id}: applies_to must be an array`);
}

for (const u of updates) {
  uniqueId(u.id, "update");
  if (!ISO_DATE.test(u.published_on)) fail(`${u.id}: bad published_on`);
  if (!["legislation", "guidance", "standards", "enforcement", "code_of_practice"].includes(u.category)) fail(`${u.id}: bad category`);
  if (!["high", "medium", "low"].includes(u.impact)) fail(`${u.id}: bad impact`);
  if (!Array.isArray(u.sources) || u.sources.some((s) => !s.title || !/^https:\/\//.test(s.url))) fail(`${u.id}: bad sources`);
}

const validateQuiz = (owner, quiz, base) => {
  if (!Array.isArray(quiz)) fail(`${owner}: quiz must be an array`);
  if (base && quiz.length !== base.length) fail(`${owner}: translated quiz has ${quiz.length} questions, base has ${base.length}`);
  quiz.forEach((q, i) => {
    if (!q.question || !Array.isArray(q.options) || q.options.length < 2) fail(`${owner} quiz ${i}: bad options`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) fail(`${owner} quiz ${i}: correct out of range`);
    if (!q.explanation) fail(`${owner} quiz ${i}: missing explanation`);
    if (base) {
      if (q.options.length !== base[i].options.length) fail(`${owner} quiz ${i}: option count differs from base`);
      if (q.correct !== base[i].correct) fail(`${owner} quiz ${i}: correct index differs from base`);
    }
  });
};

const validateSections = (owner, sections) => {
  if (!Array.isArray(sections) || sections.length === 0) fail(`${owner}: needs sections`);
  for (const s of sections) if (!s.title || !s.body) fail(`${owner}: section missing title/body`);
};

const orderIndexes = new Set();
const moduleById = new Map();
for (const m of modules) {
  uniqueId(m.id, "module");
  moduleById.set(m.id, m);
  if (!["foundation", "technical", "leadership", "role_specific"].includes(m.category)) fail(`${m.id}: bad category`);
  if (!["free", "starter", "pro", "enterprise"].includes(m.tier_required)) fail(`${m.id}: bad tier_required`);
  if (!Number.isInteger(m.duration_min) || m.duration_min <= 0) fail(`${m.id}: bad duration_min`);
  if (!Number.isInteger(m.order_index)) fail(`${m.id}: bad order_index`);
  if (orderIndexes.has(m.order_index)) fail(`${m.id}: duplicate order_index ${m.order_index}`);
  orderIndexes.add(m.order_index);
  if (!m.content_version) fail(`${m.id}: missing content_version`);
  validateSections(m.id, m.content?.sections);
  validateQuiz(m.id, m.content?.quiz);
}

const checklistIds = new Set();
const checklistById = new Map();
const validateChecklistSections = (owner, sections, base) => {
  if (!Array.isArray(sections) || sections.length === 0) fail(`${owner}: needs sections`);
  const itemIds = new Set();
  sections.forEach((s, si) => {
    if (!s.id || !s.title || !Array.isArray(s.items) || s.items.length === 0) fail(`${owner}: section ${si} malformed`);
    if (base && base[si]?.id !== s.id) fail(`${owner}: section ${si} id differs from base`);
    s.items.forEach((it, ii) => {
      if (!it.id || !it.text) fail(`${owner}: item ${s.id}/${ii} missing id/text`);
      if (itemIds.has(it.id)) fail(`${owner}: duplicate item id ${it.id}`);
      itemIds.add(it.id);
      if (base && base[si].items[ii]?.id !== it.id) fail(`${owner}: item ${it.id} order differs from base`);
    });
  });
};
for (const c of checklists) {
  uniqueId(c.id, "checklist");
  checklistIds.add(c.id);
  checklistById.set(c.id, c);
  if (!c.title || !c.description || !c.content_version) fail(`${c.id}: missing title/description/content_version`);
  validateChecklistSections(c.id, c.sections);
}

const planIds = new Set();
for (const p of plans) {
  uniqueId(p.id, "plan");
  planIds.add(p.id);
  if (!["free", "subscription", "pack", "enterprise"].includes(p.kind)) fail(`${p.id}: bad kind`);
  if (!["free", "monthly", "per_seat_monthly", "one_time", "custom"].includes(p.billing)) fail(`${p.id}: bad billing`);
  if (!["free", "starter", "pro", "enterprise"].includes(p.training_tier)) fail(`${p.id}: bad training_tier`);
  if (p.kind === "pack" && !(Number.isInteger(p.term_months) && p.term_months > 0)) fail(`${p.id}: packs need term_months`);
  if (p.billing === "per_seat_monthly" && !(Number.isInteger(p.seat_min) && p.seat_min > 0)) fail(`${p.id}: per-seat plans need seat_min`);
  if (!Number.isInteger(p.position)) fail(`${p.id}: bad position`);
  if (!Array.isArray(p.highlights)) fail(`${p.id}: highlights must be an array`);
  const e = p.entitlements;
  if (!e || typeof e !== "object") fail(`${p.id}: entitlements missing`);
  for (const key of ["checklists", "checklists_readonly"]) {
    if (!Array.isArray(e[key])) fail(`${p.id}: entitlements.${key} must be an array`);
    for (const id of e[key]) if (!checklistIds.has(id)) fail(`${p.id}: unknown checklist ${id}`);
  }
  if (!(e.seats === null || e.seats === "quantity" || Number.isInteger(e.seats))) fail(`${p.id}: entitlements.seats invalid`);
}
if (!planIds.has("free")) fail("a plan with id 'free' is required");

for (const t of translations) {
  if (!/^[a-z]{2}$/.test(t.locale)) fail(`translation locale ${t.locale} invalid`);
  for (const [moduleId, tr] of Object.entries(t.modules ?? {})) {
    const base = moduleById.get(moduleId);
    if (!base) fail(`${t.locale}: translation for unknown module ${moduleId}`);
    if (!tr.title || !tr.description) fail(`${t.locale}/${moduleId}: missing title/description`);
    validateSections(`${t.locale}/${moduleId}`, tr.content?.sections);
    if (tr.content.sections.length !== base.content.sections.length) fail(`${t.locale}/${moduleId}: section count differs from base`);
    validateQuiz(`${t.locale}/${moduleId}`, tr.content?.quiz, base.content.quiz);
  }
  for (const [checklistId, tr] of Object.entries(t.checklists ?? {})) {
    const base = checklistById.get(checklistId);
    if (!base) fail(`${t.locale}: translation for unknown checklist ${checklistId}`);
    if (!tr.title || !tr.description) fail(`${t.locale}/${checklistId}: missing title/description`);
    validateChecklistSections(`${t.locale}/${checklistId}`, tr.sections, base.sections);
  }
}

// ---- SQL emission ---------------------------------------------------------
const q = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
};
const j = (v, fallback = []) => q(JSON.stringify(v ?? fallback));
const insert = (table, cols, vals) =>
  `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${vals.join(", ")});`;

const lines = [
  "-- GENERATED FILE. Do not edit by hand: run `npm run content:build`.",
  `-- Source: content/*.json. Generated ${new Date().toISOString()}.`,
  "-- Idempotent: uses INSERT OR REPLACE so it can be re-applied after content changes.",
  "",
];

for (const d of deadlines) {
  lines.push(insert("compliance_deadlines",
    ["id", "effective_date", "title", "summary", "legal_basis", "applies_to", "status", "changed_by", "original_date", "sort_order", "updated_at"],
    [q(d.id), q(d.effective_date), q(d.title), q(d.summary), q(d.legal_basis), j(d.applies_to), q(d.status), q(d.changed_by), q(d.original_date), q(d.sort_order ?? 0), "datetime('now')"]));
}
lines.push("");

for (const u of updates) {
  lines.push(insert("regulatory_updates",
    ["id", "published_on", "title", "summary", "category", "impact", "affected_roles", "sources", "updated_at"],
    [q(u.id), q(u.published_on), q(u.title), q(u.summary), q(u.category), q(u.impact), j(u.affected_roles), j(u.sources), "datetime('now')"]));
}
lines.push("");

for (const m of modules) {
  lines.push(insert("training_modules",
    ["id", "title", "description", "category", "tier_required", "duration_min", "order_index", "content_version", "regulatory_basis", "content", "is_published", "updated_at"],
    [q(m.id), q(m.title), q(m.description), q(m.category), q(m.tier_required), q(m.duration_min), q(m.order_index), q(m.content_version), j(m.regulatory_basis), j(m.content), q(m.is_published === false ? 0 : 1), "datetime('now')"]));
}
lines.push("");

for (const c of checklists) {
  lines.push(insert("checklists",
    ["id", "title", "description", "legal_basis", "audience", "content_version", "sections", "is_published", "updated_at"],
    [q(c.id), q(c.title), q(c.description), q(c.legal_basis), q(c.audience), q(c.content_version), j(c.sections), q(c.is_published === false ? 0 : 1), "datetime('now')"]));
}
lines.push("");

for (const p of plans) {
  lines.push(insert("plans",
    ["id", "name", "kind", "position", "price_eur", "billing", "seats_included", "seat_min", "term_months", "training_tier", "stripe_price_env", "tagline", "badge", "cta", "highlights", "entitlements", "is_active", "updated_at"],
    [q(p.id), q(p.name), q(p.kind), q(p.position), q(p.price_eur), q(p.billing), q(p.seats_included), q(p.seat_min), q(p.term_months), q(p.training_tier), q(p.stripe_price_env), q(p.tagline), q(p.badge), q(p.cta), j(p.highlights), j(p.entitlements, {}), q(p.is_active === false ? 0 : 1), "datetime('now')"]));
}
lines.push("");

let translationCount = 0;
for (const t of translations) {
  for (const [moduleId, tr] of Object.entries(t.modules ?? {})) {
    const base = moduleById.get(moduleId);
    lines.push(insert("training_module_translations",
      ["module_id", "locale", "title", "description", "content", "content_version", "updated_at"],
      [q(moduleId), q(t.locale), q(tr.title), q(tr.description), j(tr.content), q(base.content_version), "datetime('now')"]));
    translationCount++;
  }
  for (const [checklistId, tr] of Object.entries(t.checklists ?? {})) {
    lines.push(insert("checklist_translations",
      ["checklist_id", "locale", "title", "description", "sections", "updated_at"],
      [q(checklistId), q(t.locale), q(tr.title), q(tr.description), j(tr.sections), "datetime('now')"]));
    translationCount++;
  }
}
lines.push("");

mkdirSync(join(root, "seeds"), { recursive: true });
const out = join(root, "seeds", "content.sql");
writeFileSync(out, lines.join("\n"));
console.log(
  `wrote ${out}: ${deadlines.length} deadlines, ${updates.length} updates, ${modules.length} modules, ` +
    `${checklists.length} checklists, ${plans.length} plans, ${translationCount} translations`
);
