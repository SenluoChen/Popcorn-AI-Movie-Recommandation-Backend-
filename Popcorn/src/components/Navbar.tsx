// src/components/Navbar.tsx ?
import { Link } from "react-router-dom";

import { useEffect, useState, Dispatch, SetStateAction } from "react";
import { MovieRecommendation } from "../utils/recommendMovies";
import { tmdbFindByImdbId, tmdbGetMovieDetails, tmdbSearchMovies } from "../utils/tmdb";

type LocalMediaTopItem = {
  imdbId: string;
  title?: string;
  posterUrl?: string | null;
  trailers?: Array<{ url?: string; name?: string; site?: string; type?: string; key?: string }>;
};

type Media1000Item = {
  tmdbId: number;
  imdbId?: string | null;
  title?: string | null;
  year?: string | null;
  posterUrl?: string | null;
  trailers?: Array<{ url?: string; name?: string; site?: string; type?: string; key?: string }>;
};

type Media1000Index = {
  byTmdbId: Map<number, Media1000Item>;
  byImdbId: Map<string, Media1000Item>;
  byTitleYear: Map<string, Media1000Item>;
};

let localTopMediaPromise: Promise<Map<string, LocalMediaTopItem>> | null = null;

async function loadLocalTopMediaByImdbId(): Promise<Map<string, LocalMediaTopItem>> {
  if (localTopMediaPromise) return localTopMediaPromise;
  localTopMediaPromise = (async () => {
    try {
      const resp = await fetch('/media_top10.json', { cache: 'no-cache' });
      if (!resp.ok) return new Map();
      const data = await resp.json().catch(() => ({}));
      const items: LocalMediaTopItem[] = Array.isArray(data?.items) ? data.items : [];
      const map = new Map<string, LocalMediaTopItem>();
      for (const it of items) {
        const imdbId = String(it?.imdbId || '').trim();
        if (!imdbId) continue;
        map.set(imdbId, it);
      }
      return map;
    } catch {
      return new Map();
    }
  })();
  return localTopMediaPromise;
}

let media1000Promise: Promise<Media1000Index> | null = null;

async function loadMedia1000Index(): Promise<Media1000Index> {
  if (media1000Promise) return media1000Promise;
  media1000Promise = (async () => {
    try {
      const resp = await fetch('/media_1000.json', { cache: 'no-cache' });
      if (!resp.ok) return { byTmdbId: new Map(), byImdbId: new Map(), byTitleYear: new Map() };
      const data = await resp.json().catch(() => ({}));

      const rawByTmdbId = (data?.byTmdbId && typeof data.byTmdbId === 'object') ? data.byTmdbId : {};
      const rawByImdbId = (data?.byImdbId && typeof data.byImdbId === 'object') ? data.byImdbId : {};

      const byTmdbId = new Map<number, Media1000Item>();
      const byImdbId = new Map<string, Media1000Item>();
      const byTitleYear = new Map<string, Media1000Item>();

      const keyTitleYear = (title: any, year: any) => {
        const t = String(title || '').trim().toLowerCase();
        const y = String(year || '').trim().slice(0, 4);
        if (!t) return '';
        return `${t}|${y}`;
      };

      for (const [k, v] of Object.entries(rawByTmdbId)) {
        const tmdbId = Number(k);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
        const item = v as Media1000Item;
        byTmdbId.set(tmdbId, item);
        const imdbId = String((item as any)?.imdbId || '').trim();
        if (/^tt\d+$/i.test(imdbId) && !byImdbId.has(imdbId)) byImdbId.set(imdbId, item);

        const kty = keyTitleYear((item as any)?.title, (item as any)?.year);
        if (kty && !byTitleYear.has(kty)) byTitleYear.set(kty, item);
      }

      for (const [k, v] of Object.entries(rawByImdbId)) {
        const imdbId = String(k || '').trim();
        if (!/^tt\d+$/i.test(imdbId)) continue;
        if (!byImdbId.has(imdbId)) byImdbId.set(imdbId, v as Media1000Item);
      }

      return { byTmdbId, byImdbId, byTitleYear };
    } catch {
      return { byTmdbId: new Map(), byImdbId: new Map(), byTitleYear: new Map() };
    }
  })();
  return media1000Promise;
}




export interface NavbarProps {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  onRecommend: (results: MovieRecommendation[], usedQuery?: string) => void;
}

function Navbar({ query, setQuery, onRecommend }: NavbarProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  // Local input state to avoid parent-driven value stomping while typing ?
  const [localQuery, setLocalQuery] = useState<string>(query || "");

  // Keep localQuery in sync when parent updates `query` from outside. ?
  useEffect(() => {
    setLocalQuery(query || "");
  }, [query]);

  // Per-session cache for enrichment results (reduces repeated TMDb calls) ?
  const enrichmentCache = (globalThis as any).__POP_ENRICH_CACHE__
    || ((globalThis as any).__POP_ENRICH_CACHE__ = new Map<string, { id: number; poster_path: string | null }>());

  function stableNegativeIdFromImdbId(imdbId: string): number {
    // Deterministic, stable, and very unlikely to collide for our list sizes. ?
    // Keeps UI working even when backend doesn't provide tmdbId and TMDb enrichment is unavailable. ?
    const s = String(imdbId || '').trim();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) | 0;
    }
    // Ensure non-zero negative. ?
    const n = Math.abs(hash) || 1;
    return -n;
  }

  async function enrichWithPosterAndTmdbId(
    items: Array<{
      title?: string;
      year?: string | number;
      tmdbId?: number | string;
      imdbId?: string;
      poster_path?: string | null;
    }>,
    opts?: { language?: string }
  ): Promise<Array<{ id: number; poster_path: string | null }>> {
    const language = opts?.language ?? "en-US";

    const runWithConcurrency = async <T, R>(arr: T[], limit: number, worker: (v: T) => Promise<R>) => {
      const results: R[] = new Array(arr.length);
      let nextIndex = 0;
      const runners = new Array(Math.max(1, limit)).fill(0).map(async () => {
        while (nextIndex < arr.length) {
          const i = nextIndex++;
          results[i] = await worker(arr[i]);
        }
      });
      await Promise.all(runners);
      return results;
    };

    const enriched = await runWithConcurrency(items, 4, async (r) => {
      const cacheKey = (() => {
        const imdbId = String(r?.imdbId || '').trim().toLowerCase();
        const title = String(r?.title || '').trim().toLowerCase();
        const year = String(r?.year || '').slice(0, 4);
        if (imdbId) return `imdb:${imdbId}`;
        return `ty:${title}|${year}`;
      })();
      const cached = enrichmentCache.get(cacheKey);
      if (cached) return cached;

      // 1) Already has TMDb id (best) ?
      const tmdbIdRaw = r?.tmdbId;
      const tmdbId = typeof tmdbIdRaw === "number" ? tmdbIdRaw : Number(tmdbIdRaw);
      if (Number.isFinite(tmdbId) && tmdbId > 0) {
        if (r?.poster_path) {
          const v = { id: tmdbId, poster_path: r.poster_path };
          enrichmentCache.set(cacheKey, v);
          return v;
        }
        try {
          const d = await tmdbGetMovieDetails(tmdbId, { language });
          const v = { id: tmdbId, poster_path: d?.poster_path ?? null };
          enrichmentCache.set(cacheKey, v);
          return v;
        } catch {
          const v = { id: tmdbId, poster_path: null };
          enrichmentCache.set(cacheKey, v);
          return v;
        }
      }

      // 2) IMDb id —> TMDb /find ?
      const imdbId = String(r?.imdbId || "").trim();
      if (/^tt\d+$/i.test(imdbId)) {
        try {
          const found = await tmdbFindByImdbId(imdbId, { language });
          const first = found?.movie_results?.[0];
          if (first?.id) {
            const v = { id: first.id, poster_path: first.poster_path ?? null };
            enrichmentCache.set(cacheKey, v);
            return v;
          }
        } catch {
          // 說明：ignore and fallback
        }
      }

      // 提醒：3) Title (+year) search fallback
      const title = String(r?.title || "").trim();
      if (!title) {
        return { id: -1, poster_path: null };
      }

      const y = r?.year;
      const yearNum = typeof y === "number" ? y : Number(String(y || "").slice(0, 4));
      try {
        const sr = await tmdbSearchMovies(title, {
          language,
          page: 1,
          include_adult: false,
          year: Number.isFinite(yearNum) ? yearNum : undefined,
        });
        const first = sr?.results?.[0];
        if (first?.id) {
          const v = { id: first.id, poster_path: first.poster_path ?? null };
          enrichmentCache.set(cacheKey, v);
          return v;
        }
      } catch {
        // 備註：ignore
      }

      const v = { id: -1, poster_path: null };
      enrichmentCache.set(cacheKey, v);
      return v;
    });

    return enriched;
  }

  // 小提醒：Semantic search API
  function getApiBaseUrl(): string {
    const raw =
      process.env.REACT_APP_RELIVRE_API_URL
      || process.env.REACT_APP_API_URL
      || '';
    const base = String(raw).trim();
    if (!base) return '';
    return base.endsWith('/') ? base : `${base}/`;
  }

  const handleSearch = async () => {
    const q = String(localQuery || '').trim();
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      const apiBaseUrl = getApiBaseUrl();
      if (!apiBaseUrl) {
        setError('API URL is not configured. Set REACT_APP_RELIVRE_API_URL in .env.local');
        onRecommend([], q);
        return;
      }
      const resp = await fetch(`${apiBaseUrl}search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, topK: 12 }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(String(data?.error || `HTTP ${resp.status}`));
      }
      // 註：Convert to UI shape
      const rawResults: any[] = Array.isArray(data?.results) ? data.results : [];

      // 註：Local downloaded media (1000) index (primary)
      const media1000 = await loadMedia1000Index();
      // 小提醒：Legacy top10 manifest (fallback)
      const localTop10ByImdbId = await loadLocalTopMediaByImdbId();

      const baseList = rawResults.map((r: any) => {
        const title = String(r?.title || "").trim();
        const year = r?.year;
        const release_date = typeof year === "string" || typeof year === "number" ? String(year) : "";
        const imdbId = String(r?.imdbId || "").trim();
        const tmdbIdNum = typeof r?.tmdbId === "number" ? r.tmdbId : Number(r?.tmdbId);
        const hasTmdbId = Number.isFinite(tmdbIdNum) && tmdbIdNum > 0;

        const titleYearKey = `${title.toLowerCase()}|${String(year || '').slice(0, 4)}`;
        const mediaItem =
          (hasTmdbId ? media1000.byTmdbId.get(tmdbIdNum) : undefined)
          || (imdbId ? media1000.byImdbId.get(imdbId) : undefined);
        const mediaItemByTitleYear = (!mediaItem && title) ? media1000.byTitleYear.get(titleYearKey) : undefined;
        const top10Item = imdbId ? localTop10ByImdbId.get(imdbId) : undefined;

        const posterUrl = ((mediaItem?.posterUrl ?? mediaItemByTitleYear?.posterUrl) ?? top10Item?.posterUrl ?? null) as string | null;
        const trailers = Array.isArray(mediaItem?.trailers)
          ? (mediaItem!.trailers as any[])
          : Array.isArray(mediaItemByTitleYear?.trailers)
            ? (mediaItemByTitleYear!.trailers as any[])
          : Array.isArray(top10Item?.trailers)
            ? (top10Item!.trailers as any[])
            : [];
        const bestTrailerUrl =
          (trailers.find((t) => t?.url && String(t?.type).toLowerCase() === 'trailer')?.url ||
            trailers.find((t) => t?.url && String(t?.type).toLowerCase() === 'teaser')?.url ||
            trailers.find((t) => t?.url)?.url ||
            null) as string | null;
        const trailerUrl = bestTrailerUrl;

        const derivedTmdbId = Number((mediaItem as any)?.tmdbId ?? (mediaItemByTitleYear as any)?.tmdbId);
        const usableTmdbId = hasTmdbId
          ? tmdbIdNum
          : (Number.isFinite(derivedTmdbId) && derivedTmdbId > 0 ? derivedTmdbId : NaN);
        return {
          // 備註：Prefer tmdbId if backend provides it; otherwise keep placeholder until enrichment fills it.
          id: Number.isFinite(usableTmdbId) && usableTmdbId > 0
            ? usableTmdbId
            : stableNegativeIdFromImdbId(imdbId || title),
          title,
          release_date,
          vote_average: undefined,
          poster_path: (typeof r?.poster_path === "string" ? r.poster_path : null) as string | null,
          imdbId: imdbId || undefined,
          posterUrl,
          trailerUrl,
          _imdbId: imdbId,
          _tmdbId: r?.tmdbId ?? (Number.isFinite(usableTmdbId) ? usableTmdbId : undefined),
          _year: year,
        };
      });

      // 提醒：Enrich posters + numeric TMDb ids when missing
      try {
        const need = baseList
          .filter((m) => !(Number.isFinite(m.id) && m.id > 0) || !m.poster_path)
          .map((m) => ({
            title: m.title,
            year: m._year,
            tmdbId: m._tmdbId,
            imdbId: m._imdbId,
            poster_path: m.poster_path,
          }));

        if (need.length) {
          const enriched = await enrichWithPosterAndTmdbId(need, { language: "en-US" });
          const byTitleYear = new Map<string, { id: number; poster_path: string | null }>();
          // 說明：fallback join key (best-effort)
          for (let i = 0; i < need.length; i++) {
            const k = `${String(need[i].title || "").toLowerCase()}|${String(need[i].year || "").slice(0, 4)}`;
            if (enriched[i]) byTitleYear.set(k, enriched[i]);
          }

          for (const m of baseList) {
            const k = `${String(m.title || "").toLowerCase()}|${String(m._year || "").slice(0, 4)}`;
            const e = byTitleYear.get(k);
            if (e) {
              if (!(Number.isFinite(m.id) && m.id > 0)) m.id = e.id;
              if (!m.poster_path) m.poster_path = e.poster_path;
            }
          }
        }
      } catch {
        // 說明：If TMDb key isn't configured or we hit rate limits, just show text results.
      }

      const list: MovieRecommendation[] = baseList
        // 說明：Keep title-only items even when we can't resolve TMDb ids.
        .filter((m) => Boolean(m.title))
        .map(({ _imdbId, _tmdbId, _year, ...m }) => m);

      onRecommend(list, q);
    } catch (e: any) {
      setError(e?.message ?? "Search failed");
      onRecommend([], q);
    } finally {
      setLoading(false);
    }
  };

  return (
    <header className="apple-navbar">
      <nav className="navbar-content">
        <div
          style={{
            height: "70px",
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            width: "100%",
            padding: "0 8px",
          }}
        >
          {/* Left: Logo */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <Link to="/" style={{ display: "block" }}>
              <img
                src="/0ce80c37-a090-461c-872f-0e45a2899756.png"
                alt="Popcorn"
                style={{
                  display: "block",
                  height: "56px",
                  width: "auto",
                  objectFit: "contain",
                  cursor: "pointer",
                }}
              />
            </Link>
          </div>

          {/* Center: Search (X/Y centered in navbar) */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 760 }}>
                <input
                  type="text"
                  placeholder="Describe the movie you want…"
                  value={localQuery}
                  onChange={(e) => {
                    setLocalQuery(e.target.value);
                    setQuery(e.target.value);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  style={{
                    width: "100%",
                    padding: "10px 76px 10px 16px",
                    borderRadius: "22px",
                    border: "1px solid #ccc",
                    fontSize: "16px",
                    height: "42px",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    backgroundColor: "#191e25",
                    color: "white",
                    padding: "6px 12px",
                    border: "none",
                    borderRadius: "20px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    height: "32px",
                  }}
                >
                  {loading ? "Searching…" : "Search"}
                </button>
            </div>
          </div>

          {/* Right: spacer column (keeps center truly centered) */}
          <div />
        </div>
      </nav>

      {error && (
        <div style={{ color: "#fff", padding: "6px 12px", fontSize: 12 }}>{error}</div>
      )}
    </header>
  );
}

export default Navbar;
