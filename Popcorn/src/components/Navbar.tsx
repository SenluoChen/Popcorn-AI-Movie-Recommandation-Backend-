// src/components/Navbar.tsx
import { Link } from "react-router-dom";

import { useState, Dispatch, SetStateAction } from "react";
import { MovieRecommendation } from "../utils/recommendMovies";
import { tmdbFindByImdbId, tmdbGetMovieDetails, tmdbSearchMovies } from "../utils/tmdb";




export interface NavbarProps {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  onRecommend: (results: MovieRecommendation[]) => void;
}

function Navbar({ query, setQuery, onRecommend }: NavbarProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // Per-session cache for enrichment results (reduces repeated TMDb calls)
  const enrichmentCache = (globalThis as any).__POP_ENRICH_CACHE__
    || ((globalThis as any).__POP_ENRICH_CACHE__ = new Map<string, { id: number; poster_path: string | null }>());

  function stableNegativeIdFromImdbId(imdbId: string): number {
    // Deterministic, stable, and very unlikely to collide for our list sizes.
    // Keeps UI working even when backend doesn't provide tmdbId and TMDb enrichment is unavailable.
    const s = String(imdbId || '').trim();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) | 0;
    }
    // Ensure non-zero negative.
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

      // 1) Already has TMDb id (best)
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

      // 2) IMDb id -> TMDb /find
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
          // ignore and fallback
        }
      }

      // 3) Title (+year) search fallback
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
        // ignore
      }

      const v = { id: -1, poster_path: null };
      enrichmentCache.set(cacheKey, v);
      return v;
    });

    return enriched;
  }

  // Semantic search API
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
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      const apiBaseUrl = getApiBaseUrl();
      if (!apiBaseUrl) {
        setError('API URL is not configured. Set REACT_APP_RELIVRE_API_URL in .env.local');
        onRecommend([]);
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
      // Convert to UI shape
      const rawResults: any[] = Array.isArray(data?.results) ? data.results : [];

      const baseList = rawResults.map((r: any) => {
        const title = String(r?.title || "").trim();
        const year = r?.year;
        const release_date = typeof year === "string" || typeof year === "number" ? String(year) : "";
        const imdbId = String(r?.imdbId || "").trim();
        const tmdbIdNum = typeof r?.tmdbId === "number" ? r.tmdbId : Number(r?.tmdbId);
        const hasTmdbId = Number.isFinite(tmdbIdNum) && tmdbIdNum > 0;
        return {
          // Prefer tmdbId if backend provides it; otherwise keep placeholder until enrichment fills it.
          id: hasTmdbId ? tmdbIdNum : stableNegativeIdFromImdbId(imdbId || title),
          title,
          release_date,
          vote_average: undefined,
          poster_path: (typeof r?.poster_path === "string" ? r.poster_path : null) as string | null,
          _imdbId: imdbId,
          _tmdbId: r?.tmdbId,
          _year: year,
        };
      });

      // Show results ASAP (even if posters aren't resolved yet)
      onRecommend(
        baseList
          .filter((m) => Boolean(m.title))
          .map(({ _imdbId, _tmdbId, _year, ...m }) => m)
      );

      // Enrich posters + numeric TMDb ids when missing
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
          // fallback join key (best-effort)
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
        // If TMDb key isn't configured or we hit rate limits, just show text results.
      }

      const list: MovieRecommendation[] = baseList
        // Keep title-only items even when we can't resolve TMDb ids.
        .filter((m) => Boolean(m.title))
        .map(({ _imdbId, _tmdbId, _year, ...m }) => m);

      onRecommend(list);
    } catch (e: any) {
      setError(e?.message ?? "Search failed");
      onRecommend([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <header className="apple-navbar">
      <nav className="navbar-content">
        <div
          style={{
            height: "80px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "0 5px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "15px",
              flex: 1,
            }}
          >
            {/* Logo */}
            <Link to="/" style={{ display: "block" }}>
              <img
                src="/0ce80c37-a090-461c-872f-0e45a2899756.png"
                alt="Popcorn"
                style={{
                  display: "block",
                  height: "90px",
                  width: "auto",
                  objectFit: "contain",
                  cursor: "pointer",
                  marginRight: "40px",
                }}
              />
            </Link>

            {/* Search */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
                flex: 1,
              }}
            >
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  type="text"
                  placeholder="Describe the movie you want…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  style={{
                    width: "100%",
                    padding: "12px 80px 12px 18px",
                    borderRadius: "22px",
                    border: "1px solid #ccc",
                    fontSize: "16px",
                    height: "48px",
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
                    padding: "8px 14px",
                    border: "none",
                    borderRadius: "20px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    height: "36px",
                  }}
                >
                  {loading ? "Searching…" : "Search"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {error && (
        <div style={{ color: "#fff", padding: "6px 12px", fontSize: 12 }}>{error}</div>
      )}
    </header>
  );
}

export default Navbar;
