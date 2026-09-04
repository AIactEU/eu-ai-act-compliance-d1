import { Hono, Context, MiddlewareHandler } from "hono";
import type { Env } from "./index";

/**
 * Regulatory-content and commercial API served from D1.
 *
 * Public (cached, no auth):
 *   GET /api/v1/deadlines                       compliance calendar with computed status
 *   GET /api/v1/deadlines.ics                   same calendar as an iCalendar feed
 *   GET /api/v1/regulatory-updates?limit=&category=
 *   GET /api/v1/plans                           active plans and packs with entitlements
 *   GET /api/v1/checklists?locale=              checklist catalogue (no items)
 *   GET /api/v1/training/modules?tier=&locale=  module catalogue (no lesson content)
 *
 * Authenticated (Bearer secret, same as /rest and /query):
 *   GET  /api/v1/plans?include_inactive=1
 *   GET  /api/v1/checklists/:id?locale=
 *   GET  /api/v1/training/modules/:id?locale=&include_answers=1
 *   POST /api/v1/training/modules/:id/grade     { answers: number[] }
 *   GET  /api/v1/tenants/:id/entitlements       plan resolved against expiry and seats
 *   GET  /api/v1/tenants/:id/literacy-evidence  Article 4 evidence report data
 *
 * Locale: `?locale=sv` (or Accept-Language) overlays a translation where one
 * exists and falls back to English otherwise. Quiz answer indexes are identical
 * across locales, so grading is locale-independent.
 */

export type Tier = "free" | "starter" | "pro" | "enterprise";
export const TIER_RANK: Record<Tier, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };
const PASS_MARK = 70;
const SUPPORTED_LOCALES = ["en", "sv"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

interface QuizQuestion {
    question: string;
    options: string[];
    correct: number;
    explanation: string;
}
interface ModuleContent {
    sections: { title: string; body: string }[];
    quiz: QuizQuestion[];
}
interface ModuleRow {
    id: string;
    title: string;
    description: string;
    category: string;
    tier_required: Tier;
    duration_min: number;
    order_index: number;
    content_version: string;
    regulatory_basis: string;
    content: string;
    updated_at: string;
}
interface TranslationRow {
    title: string;
    description: string;
    content: string;
}
interface PlanRow {
    id: string;
    name: string;
    kind: string;
    position: number;
    price_eur: number | null;
    billing: string;
    seats_included: number | null;
    seat_min: number | null;
    term_months: number | null;
    training_tier: Tier;
    stripe_price_env: string | null;
    tagline: string | null;
    badge: string | null;
    cta: string | null;
    highlights: string;
    entitlements: string;
    is_active: number;
}
interface Entitlements {
    ai_systems: number | null;
    docs_per_month: number | null;
    seats: number | "quantity" | null;
    certificates: boolean;
    evidence_report: boolean;
    audit_trail: boolean;
    checklists: string[];
    checklists_readonly: string[];
    deadline_feed: boolean;
    api_access: boolean;
    priority_support: boolean;
}
interface TenantRow {
    id: string;
    name: string | null;
    tier: string;
    plan: string;
    seats: number | null;
    plan_expires_at: string | null;
    locale: string | null;
}

export const parseJson = <T>(value: unknown, fallback: T): T => {
    if (typeof value !== "string") return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
};

const isTier = (value: string | undefined): value is Tier => value !== undefined && value in TIER_RANK;

const todayIso = () => new Date().toISOString().slice(0, 10);

const daysBetween = (fromIso: string, toIso: string) =>
    Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);

export function resolveLocale(c: Context): Locale {
    const explicit = c.req.query("locale")?.toLowerCase().slice(0, 2);
    if (explicit && (SUPPORTED_LOCALES as readonly string[]).includes(explicit)) return explicit as Locale;
    const header = c.req.header("Accept-Language") ?? "";
    for (const part of header.split(",")) {
        const tag = part.trim().toLowerCase().slice(0, 2);
        if ((SUPPORTED_LOCALES as readonly string[]).includes(tag)) return tag as Locale;
    }
    return "en";
}

const formatPlan = (row: PlanRow) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    position: row.position,
    price_eur: row.price_eur,
    billing: row.billing,
    seats_included: row.seats_included,
    seat_min: row.seat_min,
    term_months: row.term_months,
    training_tier: row.training_tier,
    stripe_price_env: row.stripe_price_env,
    tagline: row.tagline,
    badge: row.badge,
    cta: row.cta,
    highlights: parseJson<string[]>(row.highlights, []),
    entitlements: parseJson<Entitlements>(row.entitlements, {} as Entitlements),
    is_active: row.is_active === 1,
});

/**
 * Resolve a tenant's effective entitlements: expired packs fall back to the
 * free plan; per-seat plans take the seat count stored on the tenant.
 */
export async function resolveEntitlements(env: Env, tenant: TenantRow) {
    const now = new Date().toISOString();
    const expired = !!tenant.plan_expires_at && tenant.plan_expires_at < now;
    const effectivePlanId = expired ? "free" : tenant.plan || "free";

    const [planRow, freeRow] = await Promise.all([
        env.DB.prepare("SELECT * FROM plans WHERE id = ?").bind(effectivePlanId).first<PlanRow>(),
        env.DB.prepare("SELECT * FROM plans WHERE id = 'free'").first<PlanRow>(),
    ]);
    const plan = planRow ? formatPlan(planRow) : freeRow ? formatPlan(freeRow) : null;
    if (!plan) throw new Error("plans table is not seeded");

    const entitlements: Entitlements = { ...plan.entitlements };
    if (entitlements.seats === "quantity") {
        entitlements.seats = tenant.seats ?? plan.seat_min ?? 1;
    }

    return {
        tenant_id: tenant.id,
        purchased_plan: tenant.plan || "free",
        effective_plan: plan.id,
        plan_name: plan.name,
        plan_kind: plan.kind,
        expired,
        expires_at: tenant.plan_expires_at,
        training_tier: plan.training_tier,
        locale: tenant.locale ?? "en",
        entitlements,
    };
}

export function createContentRouter(auth: MiddlewareHandler<{ Bindings: Env }>) {
    const api = new Hono<{ Bindings: Env }>();

    const publicCache: MiddlewareHandler = async (c, next) => {
        await next();
        if (c.res.ok) {
            c.res.headers.set("Cache-Control", "public, max-age=300, s-maxage=900");
            c.res.headers.append("Vary", "Accept-Language");
        }
    };

    // ---- deadlines ---------------------------------------------------------
    interface DeadlineRow {
        id: string;
        effective_date: string;
        title: string;
        summary: string;
        legal_basis: string | null;
        applies_to: string;
        status: string;
        changed_by: string | null;
        original_date: string | null;
        updated_at: string;
    }
    const loadDeadlines = async (env: Env) => {
        const { results } = await env.DB.prepare(
            "SELECT id, effective_date, title, summary, legal_basis, applies_to, status, changed_by, original_date, updated_at " +
                "FROM compliance_deadlines ORDER BY effective_date ASC, sort_order ASC"
        ).all<DeadlineRow>();
        const today = todayIso();
        return results.map((row) => {
            const effective = String(row.effective_date);
            const days = daysBetween(today, effective);
            return {
                ...row,
                applies_to: parseJson<string[]>(row.applies_to, []),
                days_remaining: days,
                phase: days < 0 ? "in_application" : days === 0 ? "today" : "upcoming",
            };
        });
    };

    api.get("/deadlines", publicCache, async (c) => {
        const deadlines = await loadDeadlines(c.env);
        const next = deadlines.find((d) => d.days_remaining >= 0) ?? null;
        return c.json({ as_of: todayIso(), next_deadline: next, deadlines });
    });

    api.get("/deadlines.ics", publicCache, async (c) => {
        const deadlines = await loadDeadlines(c.env);
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
        const esc = (s: unknown) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
        const fold = (line: string) => {
            const out: string[] = [];
            let rest = line;
            while (rest.length > 73) {
                out.push(rest.slice(0, 73));
                rest = " " + rest.slice(73);
            }
            out.push(rest);
            return out.join("\r\n");
        };
        const lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Comply AI//EU AI Act Compliance Calendar//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            fold("X-WR-CALNAME:EU AI Act compliance calendar"),
        ];
        for (const d of deadlines) {
            const date = String(d.effective_date).replace(/-/g, "");
            const status = d.status === "backstop" ? " (latest date)" : "";
            lines.push(
                "BEGIN:VEVENT",
                fold(`UID:${d.id}@complyai.eu`),
                `DTSTAMP:${stamp}`,
                `DTSTART;VALUE=DATE:${date}`,
                fold(`SUMMARY:${esc(`AI Act: ${d.title}${status}`)}`),
                fold(`DESCRIPTION:${esc(`${d.summary}\n\nLegal basis: ${d.legal_basis ?? ""}`)}`),
                fold(`CATEGORIES:${esc("EU AI Act")}`),
                "TRANSP:TRANSPARENT",
                "END:VEVENT"
            );
        }
        lines.push("END:VCALENDAR");
        return c.body(lines.join("\r\n") + "\r\n", 200, {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'inline; filename="eu-ai-act-deadlines.ics"',
        });
    });

    // ---- regulatory updates -----------------------------------------------
    api.get("/regulatory-updates", publicCache, async (c) => {
        const limitRaw = parseInt(c.req.query("limit") ?? "20", 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
        const category = c.req.query("category");

        let sql =
            "SELECT id, published_on, title, summary, category, impact, affected_roles, sources, updated_at FROM regulatory_updates";
        const params: unknown[] = [];
        if (category) {
            sql += " WHERE category = ?";
            params.push(category);
        }
        sql += " ORDER BY published_on DESC LIMIT ?";
        params.push(limit);

        const { results } = await c.env.DB.prepare(sql).bind(...params).all();
        const updates = results.map((row) => ({
            ...row,
            affected_roles: parseJson<string[]>(row.affected_roles, []),
            sources: parseJson<{ title: string; url: string }[]>(row.sources, []),
        }));
        return c.json({ count: updates.length, updates });
    });

    // ---- plans ------------------------------------------------------------
    api.get("/plans", async (c, next) => {
        const includeInactive = c.req.query("include_inactive") === "1";
        if (includeInactive) return auth(c, next);
        return publicCache(c, next);
    }, async (c) => {
        const includeInactive = c.req.query("include_inactive") === "1";
        const sql = includeInactive
            ? "SELECT * FROM plans ORDER BY position ASC"
            : "SELECT * FROM plans WHERE is_active = 1 ORDER BY position ASC";
        const { results } = await c.env.DB.prepare(sql).all<PlanRow>();
        const plans = results.map(formatPlan);
        return c.json({
            currency: "EUR",
            count: plans.length,
            plans,
            packs: plans.filter((p) => p.kind === "pack").map((p) => p.id),
        });
    });

    // ---- checklists -------------------------------------------------------
    const loadChecklist = async (env: Env, id: string, locale: Locale) => {
        const base = await env.DB.prepare("SELECT * FROM checklists WHERE id = ? AND is_published = 1").bind(id).first();
        if (!base) return null;
        let tr: { title: string; description: string; sections: string } | null = null;
        if (locale !== "en") {
            tr = await env.DB.prepare("SELECT title, description, sections FROM checklist_translations WHERE checklist_id = ? AND locale = ?")
                .bind(id, locale)
                .first();
        }
        return {
            id: base.id,
            title: tr?.title ?? base.title,
            description: tr?.description ?? base.description,
            legal_basis: base.legal_basis,
            audience: base.audience,
            content_version: base.content_version,
            locale: tr ? locale : "en",
            sections: parseJson<any[]>(tr?.sections ?? base.sections, []),
            updated_at: base.updated_at,
        };
    };

    api.get("/checklists", publicCache, async (c) => {
        const locale = resolveLocale(c);
        const { results } = await c.env.DB.prepare(
            "SELECT c.id, c.title, c.description, c.legal_basis, c.audience, c.content_version, c.sections, c.updated_at, " +
                "t.title AS t_title, t.description AS t_description " +
                "FROM checklists c LEFT JOIN checklist_translations t ON t.checklist_id = c.id AND t.locale = ? " +
                "WHERE c.is_published = 1 ORDER BY c.id"
        ).bind(locale).all();
        const checklists = results.map((row) => {
            const sections = parseJson<{ items: unknown[] }[]>(row.sections, []);
            return {
                id: row.id,
                title: row.t_title ?? row.title,
                description: row.t_description ?? row.description,
                legal_basis: row.legal_basis,
                audience: row.audience,
                content_version: row.content_version,
                locale: row.t_title ? locale : "en",
                section_count: sections.length,
                item_count: sections.reduce((n, s) => n + (s.items?.length ?? 0), 0),
                updated_at: row.updated_at,
            };
        });
        return c.json({ locale, count: checklists.length, checklists });
    });

    api.get("/checklists/:id", auth, async (c) => {
        const checklist = await loadChecklist(c.env, c.req.param("id"), resolveLocale(c));
        if (!checklist) return c.json({ error: "Checklist not found" }, 404);
        return c.json(checklist);
    });

    // ---- training catalogue -----------------------------------------------
    api.get("/training/modules", publicCache, async (c) => {
        const tierParam = c.req.query("tier");
        const tier: Tier = isTier(tierParam) ? tierParam : "free";
        const locale = resolveLocale(c);

        const { results } = await c.env.DB.prepare(
            "SELECT m.id, m.title, m.description, m.category, m.tier_required, m.duration_min, m.order_index, m.content_version, m.regulatory_basis, m.updated_at, " +
                "t.title AS t_title, t.description AS t_description, " +
                "(SELECT group_concat(locale) FROM training_module_translations x WHERE x.module_id = m.id) AS locales " +
                "FROM training_modules m LEFT JOIN training_module_translations t ON t.module_id = m.id AND t.locale = ? " +
                "WHERE m.is_published = 1 ORDER BY m.order_index ASC"
        ).bind(locale).all();

        const modules = results.map((row) => {
            const required = row.tier_required as Tier;
            const { t_title, t_description, locales, ...rest } = row;
            return {
                ...rest,
                title: t_title ?? row.title,
                description: t_description ?? row.description,
                locale: t_title ? locale : "en",
                available_locales: ["en", ...String(locales ?? "").split(",").filter(Boolean)],
                regulatory_basis: parseJson<string[]>(row.regulatory_basis, []),
                locked: TIER_RANK[tier] < (TIER_RANK[required] ?? 0),
            };
        });
        return c.json({ tier, locale, count: modules.length, modules });
    });

    // ---- module content (auth) --------------------------------------------
    const loadModule = async (env: Env, id: string, locale: Locale) => {
        const row = await env.DB.prepare("SELECT * FROM training_modules WHERE id = ? AND is_published = 1")
            .bind(id)
            .first<ModuleRow>();
        if (!row) return null;
        let tr: TranslationRow | null = null;
        if (locale !== "en") {
            tr = await env.DB.prepare("SELECT title, description, content FROM training_module_translations WHERE module_id = ? AND locale = ?")
                .bind(id, locale)
                .first<TranslationRow>();
        }
        const base = parseJson<ModuleContent>(row.content, { sections: [], quiz: [] });
        const content = tr ? parseJson<ModuleContent>(tr.content, base) : base;
        return {
            row,
            locale: tr ? locale : ("en" as Locale),
            title: tr?.title ?? row.title,
            description: tr?.description ?? row.description,
            content,
            baseQuiz: base.quiz,
        };
    };

    api.get("/training/modules/:id", auth, async (c) => {
        const mod = await loadModule(c.env, c.req.param("id"), resolveLocale(c));
        if (!mod) return c.json({ error: "Module not found" }, 404);

        const includeAnswers = c.req.query("include_answers") === "1";
        const quiz = includeAnswers
            ? mod.content.quiz
            : mod.content.quiz.map(({ question, options }) => ({ question, options }));

        return c.json({
            id: mod.row.id,
            title: mod.title,
            description: mod.description,
            category: mod.row.category,
            tier_required: mod.row.tier_required,
            duration_min: mod.row.duration_min,
            order_index: mod.row.order_index,
            content_version: mod.row.content_version,
            locale: mod.locale,
            regulatory_basis: parseJson<string[]>(mod.row.regulatory_basis, []),
            updated_at: mod.row.updated_at,
            content: { sections: mod.content.sections, quiz },
        });
    });

    api.post("/training/modules/:id/grade", auth, async (c) => {
        const mod = await loadModule(c.env, c.req.param("id"), resolveLocale(c));
        if (!mod) return c.json({ error: "Module not found" }, 404);

        let body: { answers?: unknown };
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: "Body must be JSON: { answers: number[] }" }, 400);
        }
        const answers = Array.isArray(body.answers) ? body.answers : null;
        if (!answers || !answers.every((a) => Number.isInteger(a))) {
            return c.json({ error: "answers must be an array of integers" }, 400);
        }

        // Correct indexes always come from the base (English) quiz; wording from the locale.
        const quiz = mod.baseQuiz;
        if (quiz.length === 0) {
            return c.json({ score: 100, total: 0, correct: 0, passed: true, details: [] });
        }

        const details = quiz.map((q, i) => {
            const localised = mod.content.quiz[i] ?? q;
            const userAnswer = i < answers.length ? (answers[i] as number) : -1;
            return {
                question: localised.question,
                user_answer: userAnswer,
                correct_answer: q.correct,
                is_correct: userAnswer === q.correct,
                explanation: localised.explanation,
            };
        });
        const correct = details.filter((d) => d.is_correct).length;
        const score = Math.round((correct / quiz.length) * 100);

        return c.json({
            module_id: mod.row.id,
            content_version: mod.row.content_version,
            locale: mod.locale,
            score,
            total: quiz.length,
            correct,
            passed: score >= PASS_MARK,
            pass_mark: PASS_MARK,
            details,
        });
    });

    // ---- tenants: entitlements and evidence (auth) ------------------------
    const loadTenant = (env: Env, id: string) =>
        env.DB.prepare("SELECT id, name, tier, plan, seats, plan_expires_at, locale FROM tenants WHERE id = ?")
            .bind(id)
            .first<TenantRow>();

    api.get("/tenants/:id/entitlements", auth, async (c) => {
        const tenant = await loadTenant(c.env, c.req.param("id"));
        if (!tenant) return c.json({ error: "Tenant not found" }, 404);
        return c.json(await resolveEntitlements(c.env, tenant));
    });

    api.get("/tenants/:id/literacy-evidence", auth, async (c) => {
        const tenant = await loadTenant(c.env, c.req.param("id"));
        if (!tenant) return c.json({ error: "Tenant not found" }, 404);
        const ent = await resolveEntitlements(c.env, tenant);
        const locale = resolveLocale(c);

        const [modulesRes, usersRes, progressRes] = await Promise.all([
            c.env.DB.prepare(
                "SELECT m.id, m.title, m.tier_required, m.content_version, m.order_index, t.title AS t_title " +
                    "FROM training_modules m LEFT JOIN training_module_translations t ON t.module_id = m.id AND t.locale = ? " +
                    "WHERE m.is_published = 1 ORDER BY m.order_index"
            ).bind(locale).all(),
            c.env.DB.prepare("SELECT id, name, email, role, created_at FROM users WHERE tenant_id = ? ORDER BY created_at").bind(tenant.id).all(),
            c.env.DB.prepare("SELECT user_id, module_id, status, score, started_at, completed_at FROM training_progress WHERE tenant_id = ?").bind(tenant.id).all(),
        ]);

        const available = modulesRes.results
            .filter((m) => TIER_RANK[ent.training_tier] >= TIER_RANK[m.tier_required as Tier])
            .map((m) => ({
                id: String(m.id),
                title: String(m.t_title ?? m.title),
                tier_required: m.tier_required,
                content_version: m.content_version,
            }));
        const availableIds = new Set(available.map((m) => m.id));
        const titleById = new Map(available.map((m) => [m.id, m]));

        const progressByUser = new Map<string, any[]>();
        for (const p of progressRes.results) {
            const list = progressByUser.get(String(p.user_id)) ?? [];
            list.push(p);
            progressByUser.set(String(p.user_id), list);
        }

        const users = usersRes.results.map((u) => {
            const rows = progressByUser.get(String(u.id)) ?? [];
            const completed = rows
                .filter((p) => p.status === "completed" && availableIds.has(String(p.module_id)))
                .map((p) => ({
                    module_id: p.module_id,
                    title: titleById.get(String(p.module_id))?.title ?? p.module_id,
                    content_version: titleById.get(String(p.module_id))?.content_version ?? null,
                    score: p.score,
                    completed_at: p.completed_at,
                }));
            const completedIds = new Set(completed.map((x) => String(x.module_id)));
            const inProgress = rows.filter((p) => p.status === "in_progress" && availableIds.has(String(p.module_id))).map((p) => p.module_id);
            const missing = available.filter((m) => !completedIds.has(m.id)).map((m) => m.id);
            return {
                user_id: u.id,
                name: u.name ?? u.email,
                email: u.email,
                role: u.role,
                completed,
                in_progress: inProgress,
                missing,
                completion_percent: available.length ? Math.round((completed.length / available.length) * 100) : 0,
            };
        });

        const totalCompletions = users.reduce((n, u) => n + u.completed.length, 0);
        const totalPossible = users.length * available.length;

        return c.json({
            report: "article4_literacy_evidence",
            generated_at: new Date().toISOString(),
            locale,
            tenant: { id: tenant.id, name: tenant.name },
            plan: { effective_plan: ent.effective_plan, plan_name: ent.plan_name, training_tier: ent.training_tier, expired: ent.expired, expires_at: ent.expires_at, seats: ent.entitlements.seats },
            summary: {
                users: users.length,
                modules_available: available.length,
                completions: totalCompletions,
                completion_percent: totalPossible ? Math.round((totalCompletions / totalPossible) * 100) : 0,
                fully_trained_users: users.filter((u) => u.missing.length === 0 && available.length > 0).length,
            },
            modules: available,
            users,
        });
    });

    return api;
}
