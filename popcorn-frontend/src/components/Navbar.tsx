// src/components/Navbar.tsx ?
import { Link } from "react-router-dom";

import { useEffect, useMemo, useRef, useState, Dispatch, SetStateAction } from "react";
import { MovieRecommendation } from "../utils/recommendMovies";
import { tmdbFindByImdbId, tmdbGetMovieDetails, tmdbSearchMovies } from "../utils/tmdb";
import { useAuth } from "../auth/AuthContext";

import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";

import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";

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

export default function Navbar({ query, setQuery, onRecommend }: NavbarProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const { user } = useAuth();

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "confirm">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authError, setAuthError] = useState<string>("");
  const [authBusy, setAuthBusy] = useState(false);

  const auth = useAuth();

  const authTitle = useMemo(() => {
    if (authMode === "confirm") return "Confirm email";
    return authMode === "login" ? "Login" : "Sign up";
  }, [authMode]);
  // Local input state to avoid parent-driven value stomping while typing ?
  const [localQuery, setLocalQuery] = useState<string>(query || "");

  // Track input focus to avoid overwriting while the user is typing.
  const [isFocused, setIsFocused] = useState(false);

  // When user clicks Search, the input will blur before parent `query` updates.
  // Use a short-lived flag to ignore the next sync so we don't stomp in-progress input.
  const ignoreNextSyncRef = useRef(false);

  // Keep localQuery in sync when parent updates `query` from outside,
  // but don't stomp on in-progress edits (when input is focused).
  useEffect(() => {
    if (isFocused) return;
    if (ignoreNextSyncRef.current) {
      // consume the flag and skip this immediate sync
      ignoreNextSyncRef.current = false;
      return;
    }
    setLocalQuery(query || "");
  }, [query, isFocused]);

  // Per-session cache for enrichment results (reduces repeated TMDb calls) ?
  const enrichmentCache = (globalThis as any).__POP_ENRICH_CACHE__
    || ((globalThis as any).__POP_ENRICH_CACHE__ = new Map<
      string,
      { id: number; poster_path: string | null; overview?: string; vote_average?: number }
    >());

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
          const v: any = { id: tmdbId, poster_path: r.poster_path };
          enrichmentCache.set(cacheKey, v);
          return v;
        }
        try {
          const d = await tmdbGetMovieDetails(tmdbId, { language });
          const v: any = { id: tmdbId, poster_path: d?.poster_path ?? null };
          v.overview = String(d?.overview || "").trim() || undefined;
          v.vote_average = typeof d?.vote_average === 'number' && Number.isFinite(d.vote_average) ? d.vote_average : undefined;
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
            const v: any = { id: first.id, poster_path: first.poster_path ?? null };
            // Use overview/rating directly from /find (no extra network call)
            v.overview = String((first as any)?.overview || "").trim() || undefined;
            v.vote_average = typeof (first as any)?.vote_average === 'number' && Number.isFinite((first as any).vote_average)
              ? (first as any).vote_average
              : undefined;
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
          const v: any = { id: first.id, poster_path: first.poster_path ?? null };
          // Use overview/rating directly from /search result (no extra network call)
          v.overview = String(first.overview || "").trim() || undefined;
          v.vote_average = typeof first.vote_average === 'number' && Number.isFinite(first.vote_average) ? first.vote_average : undefined;
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
    // Update parent query state when a search is triggered
    try {
      // Prevent the blur-driven sync from stomping the just-typed localQuery
      try { ignoreNextSyncRef.current = true; } catch {}
      setQuery(q);
    } catch {
      // ignore
    }
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
        const overview = String(r?.overview || r?.plot || r?.description || r?.summary || "").trim();
        const tagline = String(r?.tagline || "").trim();
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
        const vote_average = typeof r?.vote_average === 'number' && Number.isFinite(r.vote_average) ? r.vote_average : undefined;

        return {
          // 備註：Prefer tmdbId if backend provides it; otherwise keep placeholder until enrichment fills it.
          id: Number.isFinite(usableTmdbId) && usableTmdbId > 0
            ? usableTmdbId
            : stableNegativeIdFromImdbId(imdbId || title),
          title,
          overview: overview || undefined,
          tagline: tagline || undefined,
          vote_average: vote_average,
          release_date,
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
              if (!m.overview && (e as any).overview) m.overview = (e as any).overview;
              if (typeof (e as any).vote_average === 'number' && m.vote_average === undefined) m.vote_average = (e as any).vote_average;
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
      {/* Keep logo at the left edge of the viewport (restore original position) */}
      <div style={{ position: 'absolute', left: 28, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', zIndex: 1200 }}>
        <Link to="/" style={{ display: 'block' }}>
          <img
            src="/image.png"
            alt="Popcorn"
            style={{ height: 56, width: 'auto', display: 'block', objectFit: 'contain', cursor: 'pointer', marginRight: 0 }}
          />
        </Link>
      </div>

      <nav
        className="navbar-content"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          paddingLeft: 0,
          paddingRight: 0,
        }}
      >
          <div
          style={{
            height: "70px",
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            width: "100%",
            paddingLeft: 0,
            paddingRight: 8,
          }}
        >
          {/* Left column left intentionally blank; logo is absolute at viewport left */}
          <div />

          {/* Center: Search (X/Y centered in navbar) */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 980, margin: "0 auto" }}>
                <input
                  type="text"
                  placeholder="Describe the movie you want…"
                  value={localQuery}
                  onChange={(e) => {
                    setLocalQuery(e.target.value);
                  }}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  style={{
                    width: "100%",
                    padding: "12px 86px 12px 18px",
                    borderRadius: "24px",
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
                    borderRadius: "22px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    height: "36px",
                  }}
                >
                  {loading ? "Searching…" : "Search"}
                </button>
            </div>
          </div>

          {/* Right column intentionally left empty — login CTA is fixed to viewport edge */}
          <div style={{ width: 8 }} />
        </div>
      </nav>

      {/* Fixed login/profile CTA at top-right */}
      <div className="pc-login-cta" aria-hidden={false}>
        {user ? (
          <>
            <Link className="pc-login-pill" to="/my-list" aria-label="My Favorites">
              <FavoriteBorderRoundedIcon />
              <span className="pc-mylist-label">My Favorites</span>
            </Link>
            <button
              className="pc-login-pill pc-login-avatar"
              title={user.email}
              onClick={() => {
                // open profile/quick menu: keep current behavior simple — open auth dialog for now
                setAuthMode("login");
                setAuthOpen(true);
              }}
            >
              {((user as any)?.avatarUrl) ? (
                <img src={(user as any).avatarUrl} alt="avatar" className="pc-login-avatar-img" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 20c0-3.3137 2.6863-6 6-6h4c3.3137 0 6 2.6863 6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </>
        ) : (
          <button
            className="pc-login-pill"
            onClick={() => {
              setAuthMode("login");
              setAuthError("");
              setAuthCode("");
              setAuthOpen(true);
            }}
            aria-label="Login"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M16 17l5-5-5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M11 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="pc-login-pill-label">Login</span>
          </button>
        )}
      </div>

      <Dialog
        open={authOpen}
        onClose={() => {
          if (authBusy) return;
          setAuthOpen(false);
        }}
        PaperProps={{
            sx: {
              backgroundColor: "var(--brand-900)",
              border: "1px solid var(--border-1)",
              borderRadius: 3,
              color: "var(--text-invert)",
              width: "min(700px, 94vw)",
              overflow: "hidden",
            },
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          <div className="pc-auth-dialog">
            <div className="pc-auth-right pc-auth-single">
              <div className="pc-auth-header">
                <div className="pc-section-title" style={{ fontSize: 28 }}>{authTitle}</div>
                <div className="pc-section-sub">
                  {authMode === "login"
                    ? "Enter your email and password"
                    : authMode === "signup"
                      ? "Create an account to get started"
                      : "Please enter the verification code sent to your email"}
                </div>
              </div>

              <div className="pc-auth-tabs">
                <Button
                  variant={authMode === "login" ? "contained" : "outlined"}
                  onClick={() => {
                    if (authBusy) return;
                    setAuthMode("login");
                    setAuthError("");
                    setAuthCode("");
                  }}
                  sx={{
                    fontWeight: 900,
                    borderRadius: 999,
                    textTransform: "none",
                    backgroundColor: authMode === "login" ? "var(--accent-500)" : undefined,
                    color: authMode === "login" ? "white" : "var(--accent-500)",
                    borderColor: "var(--accent-500)",
                    '&:hover': {
                      backgroundColor: authMode === "login" ? 'color-mix(in srgb, var(--accent-500) 85%, black 15%)' : 'color-mix(in srgb, var(--accent-500) 10%, transparent)'
                    }
                  }}
                  >
                  Login
                </Button>
                <Button
                  variant={authMode === "signup" ? "contained" : "outlined"}
                  onClick={() => {
                    if (authBusy) return;
                    setAuthMode("signup");
                    setAuthError("");
                    setAuthCode("");
                  }}
                  sx={{
                    fontWeight: 900,
                    borderRadius: 999,
                    textTransform: "none",
                    backgroundColor: authMode === "signup" ? "var(--accent-500)" : undefined,
                    color: authMode === "signup" ? "white" : "var(--accent-500)",
                    borderColor: "var(--accent-500)",
                    '&:hover': {
                      backgroundColor: authMode === "signup" ? 'color-mix(in srgb, var(--accent-500) 85%, black 15%)' : 'color-mix(in srgb, var(--accent-500) 10%, transparent)'
                    }
                  }}
                >
                  Sign up
                </Button>
              </div>

              <Divider sx={{ my: 2, borderColor: "color-mix(in srgb, var(--text-invert) 12%, transparent)" }} />

              {authMode !== "confirm" ? (
                <>
                  <TextField
                    fullWidth
                    label="Email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    autoComplete="email"
                    size="small"
                    className="pc-auth-input"
                    sx={{ mb: 1.5 }}
                    InputLabelProps={{ style: { color: "color-mix(in srgb, var(--text-invert) 72%, transparent)" } }}
                  />
                  <TextField
                    fullWidth
                    label="Password"
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    size="small"
                    className="pc-auth-input"
                    sx={{ mb: 1.25 }}
                    InputLabelProps={{ style: { color: "color-mix(in srgb, var(--text-invert) 72%, transparent)" } }}
                  />
                </>
              ) : (
                <>
                  <div className="pc-auth-hint">
                    We've sent a verification code to <span className="pc-auth-strong">{authEmail}</span>
                  </div>
                  <TextField
                    fullWidth
                    label="Verification code"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    autoComplete="one-time-code"
                    size="small"
                    className="pc-auth-input"
                    sx={{ mb: 1.25 }}
                    InputLabelProps={{ style: { color: "color-mix(in srgb, var(--text-invert) 72%, transparent)" } }}
                  />
                </>
              )}

              {authError ? <div className="pc-auth-error">{authError}</div> : null}

              <div className="pc-auth-actions">
                <Button
                  variant="text"
                  onClick={() => setAuthOpen(false)}
                  disabled={authBusy}
                  sx={{ fontWeight: 900, color: "color-mix(in srgb, var(--text-invert) 78%, transparent)", textTransform: "none" }}
                >
                  取消
                </Button>
                <Button
                  variant="contained"
                  disabled={authBusy}
                  onClick={async () => {
                    if (authBusy) return;
                    setAuthBusy(true);
                    setAuthError("");
                    try {
                      if (authMode === "login") {
                        await auth.login(authEmail, authPassword);
                        setAuthOpen(false);
                        setAuthPassword("");
                        setAuthCode("");
                      } else if (authMode === "signup") {
                        const out = await auth.signup(authEmail, authPassword);
                        if (out.next === "confirm") {
                          setAuthMode("confirm");
                          setAuthError("");
                        } else {
                          await auth.login(authEmail, authPassword);
                          setAuthOpen(false);
                          setAuthPassword("");
                          setAuthCode("");
                        }
                      } else {
                        await auth.confirm(authEmail, authCode);
                        await auth.login(authEmail, authPassword);
                        setAuthOpen(false);
                        setAuthPassword("");
                        setAuthCode("");
                        setAuthMode("login");
                      }
                    } catch (e: any) {
                      setAuthError(String(e?.message || "Login failed"));
                    } finally {
                      setAuthBusy(false);
                    }
                  }}
                  sx={{
                    fontWeight: 900,
                    textTransform: "none",
                    borderRadius: 999,
                    px: 2.5,
                    backgroundColor: 'var(--accent-500)',
                    color: 'white',
                    '&:hover': { backgroundColor: 'color-mix(in srgb, var(--accent-500) 85%, black 15%)' }
                  }}
                >
                    {authMode === "login" ? "Login" : authMode === "signup" ? "Create account" : "Confirm and Login"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {error && (
        <div style={{ color: "#fff", padding: "6px 12px", fontSize: 12 }}>{error}</div>
      )}
    </header>
  );
}
