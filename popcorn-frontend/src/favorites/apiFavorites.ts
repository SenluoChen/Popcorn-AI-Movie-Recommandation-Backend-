import type { FavoriteMovie } from "./types";

const base = (process.env.REACT_APP_AUTH_API_BASE || "http://localhost:3001").replace(/\/+$|\s+/g, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "include",
  });

  const text = await res.text().catch(() => "");
  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // keep a minimal error; auth/apiAuth.ts already has more detailed messaging
      throw new Error(`Favorites API returned non-JSON (HTTP ${res.status})`);
    }
  }

  if (!res.ok) {
    throw new Error(String(json?.error || res.statusText || "Request failed"));
  }

  return json as T;
}

export async function apiGetFavorites(): Promise<FavoriteMovie[]> {
  const out = await api<{ ok: true; items: FavoriteMovie[] }>("/favorites", { method: "GET" });
  return Array.isArray(out.items) ? out.items : [];
}

export async function apiToggleFavorite(movie: { tmdbId: number; title: string; year?: string; posterUrl?: string }): Promise<FavoriteMovie[]> {
  const out = await api<{ ok: true; items: FavoriteMovie[] }>("/favorites/toggle", {
    method: "POST",
    body: JSON.stringify(movie),
  });
  return Array.isArray(out.items) ? out.items : [];
}
