import { Router } from "express";
import { env } from "../env.js";
import { verifyCognitoJwt, verifyMockJwt } from "../jwt.js";
import { getFavoritesForUser, toggleFavoriteForUser } from "../store/favoritesStore.js";
export const favoritesRouter = Router();
function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}
function getCookie(req, name) {
    return String(req?.cookies?.[name] || "");
}
async function requireUserEmail(req) {
    const idToken = getCookie(req, env.cookieNameId);
    if (!idToken)
        throw new Error("Not authenticated");
    const verified = env.authMode === "mock" ? await verifyMockJwt(idToken, "id") : await verifyCognitoJwt(idToken, "id");
    const email = normalizeEmail(String(verified.claims.email || ""));
    if (!email)
        throw new Error("Not authenticated");
    return email;
}
favoritesRouter.get("/", async (req, res) => {
    try {
        const email = await requireUserEmail(req);
        const items = await getFavoritesForUser(email);
        res.json({ ok: true, items });
    }
    catch (e) {
        const msg = String(e?.message || "Not authenticated");
        res.status(401).json({ error: msg });
    }
});
favoritesRouter.post("/toggle", async (req, res) => {
    try {
        const email = await requireUserEmail(req);
        const body = (req.body ?? {});
        const movie = {
            tmdbId: Number(body?.tmdbId),
            title: String(body?.title || "").trim(),
            year: body?.year ? String(body.year) : undefined,
            posterUrl: body?.posterUrl ? String(body.posterUrl) : undefined,
        };
        if (!Number.isFinite(movie.tmdbId) || movie.tmdbId <= 0) {
            return res.status(400).json({ error: "tmdbId is required" });
        }
        const items = await toggleFavoriteForUser(email, movie);
        res.json({ ok: true, items });
    }
    catch (e) {
        const msg = String(e?.message || "Not authenticated");
        const code = msg.toLowerCase().includes("auth") ? 401 : 500;
        res.status(code).json({ error: msg });
    }
});
