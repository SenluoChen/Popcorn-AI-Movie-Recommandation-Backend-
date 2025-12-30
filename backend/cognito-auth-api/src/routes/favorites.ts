import { Router } from "express";
import { env } from "../env.js";
import { verifyCognitoJwt, verifyMockJwt } from "../jwt.js";
import { getFavoritesForUser, toggleFavoriteForUser, type FavoriteMovieInput } from "../store/favoritesStore.js";

export const favoritesRouter = Router();

type Json = Record<string, any>;

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function getCookie(req: any, name: string): string {
  return String(req?.cookies?.[name] || "");
}

async function requireUserEmail(req: any): Promise<string> {
  const idToken = getCookie(req, env.cookieNameId);
  if (!idToken) throw new Error("Not authenticated");

  const verified = env.authMode === "mock" ? await verifyMockJwt(idToken, "id") : await verifyCognitoJwt(idToken, "id");
  const email = normalizeEmail(String((verified.claims as any).email || ""));
  if (!email) throw new Error("Not authenticated");
  return email;
}

favoritesRouter.get("/", async (req, res) => {
  try {
    const email = await requireUserEmail(req);
    const items = await getFavoritesForUser(email);
    res.json({ ok: true, items } as Json);
  } catch (e: any) {
    const msg = String(e?.message || "Not authenticated");
    res.status(401).json({ error: msg } as Json);
  }
});

favoritesRouter.post("/toggle", async (req, res) => {
  try {
    const email = await requireUserEmail(req);

    const body = (req.body ?? {}) as any;
    const movie: FavoriteMovieInput = {
      tmdbId: Number(body?.tmdbId),
      title: String(body?.title || "").trim(),
      year: body?.year ? String(body.year) : undefined,
      posterUrl: body?.posterUrl ? String(body.posterUrl) : undefined,
    };

    if (!Number.isFinite(movie.tmdbId) || movie.tmdbId <= 0) {
      return res.status(400).json({ error: "tmdbId is required" } as Json);
    }

    const items = await toggleFavoriteForUser(email, movie);
    res.json({ ok: true, items } as Json);
  } catch (e: any) {
    const msg = String(e?.message || "Not authenticated");
    const code = msg.toLowerCase().includes("auth") ? 401 : 500;
    res.status(code).json({ error: msg } as Json);
  }
});
