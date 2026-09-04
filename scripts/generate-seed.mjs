#!/usr/bin/env node
/**
 * Generates migrations/0002_seed_content.sql from the JSON files in content/.
 *
 * The output uses INSERT OR REPLACE, so it is safe to re-run against a database
 * that already holds earlier versions of the rows:
 *
 *   npm run content:build
 *   npx wrangler d1 execute DB --remote --file=migrations/0002_seed_content.sql
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(root, "content", name), "utf8"));

const deadlines = readJson("deadlines.json");
const updates = readJson("regulatory-updates.json");
const modules = readJson("training-modules.json");

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

const orderIndexes = new Set();
for (const m of modules) {
  uniqueId(m.id, "module");
  if (!["foundation", "technical", "leadership", "role_specific"].includes(m.category)) fail(`${m.id}: bad category`);
  if (!["free", "starter", "pro", "enterprise"].includes(m.tier_required)) fail(`${m.id}: bad tier_required`);
  if (!Number.isInteger(m.duration_min) || m.duration_min <= 0) fail(`${m.id}: bad duration_min`);
  if (!Number.isInteger(m.order_index)) fail(`${m.id}: bad order_index`);
  if (orderIndexes.has(m.order_index)) fail(`${m.id}: duplicate order_index ${m.order_index}`);
  orderIndexes.add(m.order_index);
  if (!m.content_version) fail(`${m.id}: missing content_version`);
  if (!Array.isArray(m.content?.sections) || m.content.sections.length === 0) fail(`${m.id}: needs sections`);
  for (const s of m.content.sections) {
    if (!s.title || !s.body) fail(`${m.id}: section missing title/body`);
  }
  if (!Array.isArray(m.content?.quiz)) fail(`${m.id}: quiz must be an array`);
  m.content.quiz.forEach((q, i) => {
    if (!q.question || !Array.isArray(q.options) || q.options.length < 2) fail(`${m.id} quiz ${i}: bad options`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) fail(`${m.id} quiz ${i}: correct out of range`);
    if (!q.explanation) fail(`${m.id} quiz ${i}: missing explanation`);
  });
}

// ---- SQL emission ---------------------------------------------------------
const q = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
const j = (v) => q(JSON.stringify(v ?? []));

const lines = [
  "-- GENERATED FILE. Do not edit by hand: run `npm run content:build`.",
  `-- Source: content/*.json. Generated ${new Date().toISOString()}.`,
  "-- Idempotent: uses INSERT OR REPLACE so it can be re-applied after content changes.",
  "",
];

for (const d of deadlines) {
  lines.push(
    "INSERT OR REPLACE INTO compliance_deadlines " +
      "(id, effective_date, title, summary, legal_basis, applies_to, status, changed_by, original_date, sort_order, updated_at) VALUES (" +
      [q(d.id), q(d.effective_date), q(d.title), q(d.summary), q(d.legal_basis), j(d.applies_to), q(d.status), q(d.changed_by), q(d.original_date), q(d.sort_order ?? 0), "datetime('now')"].join(", ") +
      ");"
  );
}
lines.push("");

for (const u of updates) {
  lines.push(
    "INSERT OR REPLACE INTO regulatory_updates " +
      "(id, published_on, title, summary, category, impact, affected_roles, sources, updated_at) VALUES (" +
      [q(u.id), q(u.published_on), q(u.title), q(u.summary), q(u.category), q(u.impact), j(u.affected_roles), j(u.sources), "datetime('now')"].join(", ") +
      ");"
  );
}
lines.push("");

for (const m of modules) {
  lines.push(
    "INSERT OR REPLACE INTO training_modules " +
      "(id, title, description, category, tier_required, duration_min, order_index, content_version, regulatory_basis, content, is_published, updated_at) VALUES (" +
      [q(m.id), q(m.title), q(m.description), q(m.category), q(m.tier_required), q(m.duration_min), q(m.order_index), q(m.content_version), j(m.regulatory_basis), j(m.content), q(m.is_published === false ? 0 : 1), "datetime('now')"].join(", ") +
      ");"
  );
}
lines.push("");

const out = join(root, "migrations", "0002_seed_content.sql");
writeFileSync(out, lines.join("\n"));
console.log(`wrote ${out}: ${deadlines.length} deadlines, ${updates.length} updates, ${modules.length} training modules`);
