import { Hono, MiddlewareHandler } from "hono";
import type { Env } from "./index";

/**
 * Regulatory-content API served from D1.
 *
 * Public (cached, no auth):
 *   GET /api/v1/deadlines                      compliance calendar with computed status
 *   GET /api/v1/regulatory-updates?limit=&category=
 *   GET /api/v1/training/modules?tier=         module catalogue (no lesson content)
 *
 * Authenticated (Bearer secret, same as /rest and /query):
 *   GET  /api/v1/training/modules/:id          full lesson content, quiz without answers
 *   GET  /api/v1/training/modules/:id?include_answers=1
 *   POST /api/v1/training/modules/:id/grade    { answers: number[] } -> score, passed, details
 */

type Tier = "free" | "starter" | "pro" | "enterprise";
const TIER_RANK: Record<Tier, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };
const PASS_MARK = 70;

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

const parseJson = <T>(value: unknown, fallback: T): T => {
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

export function createContentRouter(auth: MiddlewareHandler<{ Bindings: Env }>) {
    const api = new Hono<{ Bindings: Env }>();

    const publicCache: MiddlewareHandler = async (c, next) => {
        await next();
        if (c.res.ok) c.res.headers.set("Cache-Control", "public, max-age=300, s-maxage=900");
    };

    // ---- deadlines ---------------------------------------------------------
    api.get("/deadlines", publicCache, async (c) => {
        const { results } = await c.env.DB.prepare(
            "SELECT id, effective_date, title, summary, legal_basis, applies_to, status, changed_by, original_date, updated_at " +
                "FROM compliance_deadlines ORDER BY effective_date ASC, sort_order ASC"
        ).all();

        const today = todayIso();
        const deadlines = results.map((row) => {
            const effective = String(row.effective_date);
            const days = daysBetween(today, effective);
            return {
                ...row,
                applies_to: parseJson<string[]>(row.applies_to, []),
                days_remaining: days,
                phase: days < 0 ? "in_application" : days === 0 ? "today" : "upcoming",
            };
        });
        const next = deadlines.find((d) => d.days_remaining >= 0) ?? null;
        return c.json({ as_of: today, next_deadline: next, deadlines });
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

    // ---- training catalogue -----------------------------------------------
    api.get("/training/modules", publicCache, async (c) => {
        const tierParam = c.req.query("tier");
        const tier: Tier = isTier(tierParam) ? tierParam : "free";

        const { results } = await c.env.DB.prepare(
            "SELECT id, title, description, category, tier_required, duration_min, order_index, content_version, regulatory_basis, updated_at " +
                "FROM training_modules WHERE is_published = 1 ORDER BY order_index ASC"
        ).all();

        const modules = results.map((row) => {
            const required = row.tier_required as Tier;
            return {
                ...row,
                regulatory_basis: parseJson<string[]>(row.regulatory_basis, []),
                locked: TIER_RANK[tier] < (TIER_RANK[required] ?? 0),
            };
        });
        return c.json({ tier, count: modules.length, modules });
    });

    // ---- module content (auth) --------------------------------------------
    const loadModule = async (env: Env, id: string): Promise<ModuleRow | null> => {
        const row = await env.DB.prepare("SELECT * FROM training_modules WHERE id = ? AND is_published = 1")
            .bind(id)
            .first<ModuleRow>();
        return row ?? null;
    };

    api.get("/training/modules/:id", auth, async (c) => {
        const mod = await loadModule(c.env, c.req.param("id"));
        if (!mod) return c.json({ error: "Module not found" }, 404);

        const content = parseJson<ModuleContent>(mod.content, { sections: [], quiz: [] });
        const includeAnswers = c.req.query("include_answers") === "1";
        const quiz = includeAnswers
            ? content.quiz
            : content.quiz.map(({ question, options }) => ({ question, options }));

        return c.json({
            id: mod.id,
            title: mod.title,
            description: mod.description,
            category: mod.category,
            tier_required: mod.tier_required,
            duration_min: mod.duration_min,
            order_index: mod.order_index,
            content_version: mod.content_version,
            regulatory_basis: parseJson<string[]>(mod.regulatory_basis, []),
            updated_at: mod.updated_at,
            content: { sections: content.sections, quiz },
        });
    });

    api.post("/training/modules/:id/grade", auth, async (c) => {
        const mod = await loadModule(c.env, c.req.param("id"));
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

        const { quiz } = parseJson<ModuleContent>(mod.content, { sections: [], quiz: [] });
        if (quiz.length === 0) {
            return c.json({ score: 100, total: 0, correct: 0, passed: true, details: [] });
        }

        const details = quiz.map((q, i) => {
            const userAnswer = i < answers.length ? (answers[i] as number) : -1;
            return {
                question: q.question,
                user_answer: userAnswer,
                correct_answer: q.correct,
                is_correct: userAnswer === q.correct,
                explanation: q.explanation,
            };
        });
        const correct = details.filter((d) => d.is_correct).length;
        const score = Math.round((correct / quiz.length) * 100);

        return c.json({
            module_id: mod.id,
            content_version: mod.content_version,
            score,
            total: quiz.length,
            correct,
            passed: score >= PASS_MARK,
            pass_mark: PASS_MARK,
            details,
        });
    });

    return api;
}
