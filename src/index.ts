import { Hono, Context, Next } from "hono";
import { cors } from "hono/cors";
import { handleRest } from "./rest";
import { createContentRouter } from "./content";

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
//   GET  /api/v1/deadlines                         public
//   GET  /api/v1/regulatory-updates                public
//   GET  /api/v1/training/modules                  public catalogue
//   GET  /api/v1/training/modules/:id              auth
//   POST /api/v1/training/modules/:id/grade        auth
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

export default app satisfies ExportedHandler<Env>;
