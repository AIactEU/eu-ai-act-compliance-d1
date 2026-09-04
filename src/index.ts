import { Hono, Context, Next } from "hono";
import { cors } from "hono/cors";
import { handleRest } from "./rest";
import { createContentRouter, parseJson } from "./content";

export interface Env {
    DB: D1Database;
    /** Cloudflare Secrets Store binding holding the API bearer token (production). */
    SECRET?: SecretsStoreSecret;
    /** Plain var fallback for local development: `wrangler dev --var API_SECRET:...`. */
    API_SECRET?: string;
}

// Routes
//
//   GET  /health                                   liveness + D1 reachability
//   GET  /embed/deadlines                          embeddable HTML calendar widget (public)
//   GET  /api/v1/deadlines, /deadlines.ics         public
//   GET  /api/v1/regulatory-updates                public
//   GET  /api/v1/plans                             public
//   GET  /api/v1/checklists                        public catalogue
//   GET  /api/v1/training/modules                  public catalogue
//   GET  /api/v1/checklists/:id                    auth
//   GET  /api/v1/training/modules/:id              auth
//   POST /api/v1/training/modules/:id/grade        auth
//   GET  /api/v1/tenants/:id/entitlements          auth
//   GET  /api/v1/tenants/:id/literacy-evidence     auth
//   *    /rest/{table}[/{id}]                      auth, generic CRUD (see rest.ts)
//   POST /query                                    auth, raw parameterised SQL

let cachedSecret: string | null = null;

async function resolveSecret(env: Env): Promise<string | null> {
    if (cachedSecret) return cachedSecret;
    if (env.SECRET) {
        try {
            cachedSecret = await env.SECRET.get();
            return cachedSecret;
        } catch (err) {
            console.warn("Secrets Store unavailable, falling back to API_SECRET var", err);
        }
    }
    if (env.API_SECRET) {
        cachedSecret = env.API_SECRET;
        return cachedSecret;
    }
    return null;
}

function timingSafeEqual(a: string, b: string): boolean {
    const enc = new TextEncoder();
    const ab = enc.encode(a);
    const bb = enc.encode(b);
    if (ab.byteLength !== bb.byteLength) return false;
    return crypto.subtle.timingSafeEqual(ab, bb);
}

const authMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
    const secret = await resolveSecret(c.env);
    if (!secret) {
        return c.json({ error: "Server misconfigured: no API secret bound" }, 500);
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;
    if (!timingSafeEqual(token, secret)) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
};

const escapeHtml = (s: unknown) =>
    String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/health", async (c) => {
    try {
        await c.env.DB.prepare("SELECT 1").first();
        return c.json({ ok: true, db: "reachable" });
    } catch (error: any) {
        return c.json({ ok: false, db: "unreachable", error: error.message }, 503);
    }
});

/**
 * Embeddable compliance calendar for partner and advisor sites.
 *   <iframe src="https://<worker>/embed/deadlines?brand=Acme%20Advisors&accent=%230052cc&limit=6" ...>
 */
app.get("/embed/deadlines", async (c) => {
    const brand = (c.req.query("brand") ?? "Comply AI").slice(0, 60);
    const accentRaw = c.req.query("accent") ?? "#0052cc";
    const accent = /^#[0-9a-fA-F]{6}$/.test(accentRaw) ? accentRaw : "#0052cc";
    const limitRaw = parseInt(c.req.query("limit") ?? "6", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 12) : 6;
    const showPast = c.req.query("past") === "1";

    const { results } = await c.env.DB.prepare(
        "SELECT id, effective_date, title, summary, status, original_date, applies_to FROM compliance_deadlines ORDER BY effective_date ASC, sort_order ASC"
    ).all();
    const today = new Date().toISOString().slice(0, 10);
    const rows = results
        .filter((r) => showPast || String(r.effective_date) >= today)
        .slice(0, limit)
        .map((r) => {
            const days = Math.round((Date.parse(String(r.effective_date)) - Date.parse(today)) / 86_400_000);
            const date = new Date(String(r.effective_date)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
            const badge = r.status === "backstop" ? "latest date" : days < 0 ? "in force" : days === 0 ? "today" : `${days} days`;
            return `<li class="row">
  <div class="date"><span>${escapeHtml(date)}</span><em>${escapeHtml(badge)}</em></div>
  <div class="body"><strong>${escapeHtml(r.title)}</strong><p>${escapeHtml(r.summary)}</p>${r.original_date ? `<small>Originally ${escapeHtml(r.original_date)}, amended by the 2026 Digital Omnibus.</small>` : ""}</div>
</li>`;
        })
        .join("\n");

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EU AI Act compliance calendar</title>
<style>
  :root{--accent:${accent}}
  body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a202c;background:#fff}
  .wrap{padding:16px}
  h1{font-size:16px;margin:0 0 4px}
  .sub{color:#718096;font-size:12px;margin:0 0 12px}
  ul{list-style:none;margin:0;padding:0}
  .row{display:grid;grid-template-columns:120px 1fr;gap:12px;padding:10px 0;border-top:1px solid #e2e8f0}
  .row:first-child{border-top:0}
  .date span{display:block;font-weight:600;color:var(--accent)}
  .date em{font-style:normal;font-size:11px;color:#718096}
  .body p{margin:2px 0 0;color:#4a5568;font-size:13px}
  .body small{color:#a0aec0;font-size:11px}
  .foot{margin-top:12px;font-size:11px;color:#a0aec0}
  .foot a{color:var(--accent);text-decoration:none}
</style></head>
<body><div class="wrap">
<h1>EU AI Act compliance calendar</h1>
<p class="sub">Regulation (EU) 2024/1689 as amended by Regulation (EU) 2026/1744. Updated ${escapeHtml(today)}.</p>
<ul>
${rows || '<li class="row"><div class="body">No upcoming deadlines.</div></li>'}
</ul>
<p class="foot">Provided by ${escapeHtml(brand)} with <a href="https://complyai.eu" rel="noopener" target="_blank">Comply AI</a>. Not legal advice.</p>
</div></body></html>`;

    return c.html(html, 200, {
        "Cache-Control": "public, max-age=900",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *",
    });
});

app.route("/api/v1", createContentRouter(authMiddleware));

// Generic CRUD REST endpoints for every table
app.all("/rest/*", authMiddleware, handleRest);

// Raw parameterised SQL
app.post("/query", authMiddleware, async (c) => {
    try {
        const body = await c.req.json();
        const { query, params } = body;

        if (!query) {
            return c.json({ error: "Query is required" }, 400);
        }

        const results = await c.env.DB.prepare(query)
            .bind(...(params || []))
            .all();

        return c.json(results);
    } catch (error: any) {
        return c.json({ error: error.message }, 500);
    }
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

// Referenced so the helper stays exported for tests and future routes.
void parseJson;

export default app satisfies ExportedHandler<Env>;
