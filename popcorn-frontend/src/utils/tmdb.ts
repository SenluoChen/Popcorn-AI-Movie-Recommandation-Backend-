export type TmdbMovie = {
  id: number;
  title: string;
  overview?: string;
  tagline?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  original_language?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
};

export type TmdbGenre = { id: number; name: string };

const TMDB_BASE = "https://api.themoviedb.org/3";

// Simple in-memory cache (per-tab). Helps a lot because search results often repeat. ?
const TMDB_CACHE = new Map<
  string,
  {
    ts: number;
    value: any;
  }
>();

// Best-effort sessionStorage cache to survive refreshes
const TMDB_SESSION_CACHE_PREFIX = "pc:tmdb:v1:";
const TMDB_SESSION_MAX_CHARS = 200_000; // safety cap per entry

function nowMs() {
  return Date.now();
}

function requireApiKey(): string {
  const key = process.env.REACT_APP_TMDB_API_KEY;
  if (!key) {
    throw new Error(
      "Missing REACT_APP_TMDB_API_KEY. Add it to .env (TMDb v3 API key)."
    );
  }
  return key;
}

function buildUrl(path: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", requireApiKey());
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined) return;
    url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function tmdbGet<T>(path: string, params: Record<string, string | number | boolean | undefined>) {
  const url = buildUrl(path, params);

  const ttlMs = 12 * 60 * 60 * 1000; // 12h ?
  const cached = TMDB_CACHE.get(url);
  if (cached && nowMs() - cached.ts <= ttlMs) {
    return cached.value as T;
  }

  if (typeof sessionStorage !== "undefined") {
    try {
      const raw = sessionStorage.getItem(TMDB_SESSION_CACHE_PREFIX + url);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; value: T };
        if (parsed && typeof parsed.ts === "number" && nowMs() - parsed.ts <= ttlMs) {
          TMDB_CACHE.set(url, { ts: parsed.ts, value: parsed.value });
          return parsed.value as T;
        }
      }
    } catch {
      // ignore
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TMDb request failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as T;
  TMDB_CACHE.set(url, { ts: nowMs(), value: data });

  if (typeof sessionStorage !== "undefined") {
    try {
      const payload = JSON.stringify({ ts: nowMs(), value: data });
      if (payload.length <= TMDB_SESSION_MAX_CHARS) {
        sessionStorage.setItem(TMDB_SESSION_CACHE_PREFIX + url, payload);
      }
    } catch {
      // ignore quota / serialization errors
    }
  }
  // Bound cache size ?
  if (TMDB_CACHE.size > 500) {
    let oldestKey: string | undefined;
    let oldestTs = Infinity;
    TMDB_CACHE.forEach((v, k) => {
      if (v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    });
    if (oldestKey) TMDB_CACHE.delete(oldestKey);
  }
  return data;
}

export function tmdbImage(path: string | null | undefined, size: "w185" | "w342" | "w500" | "original" = "w342") {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export async function tmdbSearchMovies(
  query: string,
  opts?: { page?: number; language?: string; include_adult?: boolean; year?: number }
) {
  return tmdbGet<{ page: number; results: TmdbMovie[]; total_pages: number; total_results: number }>(
    "/search/movie",
    {
      query,
      page: opts?.page ?? 1,
      language: opts?.language,
      include_adult: opts?.include_adult ?? false,
      year: opts?.year,
    }
  );
}

export async function tmdbFindByImdbId(imdbId: string, opts?: { language?: string }) {
  const externalId = String(imdbId || "").trim();
  if (!externalId) {
    throw new Error("imdbId is required");
  }

  return tmdbGet<{
    movie_results: Array<{
      id: number;
      title: string;
      overview?: string;
      vote_average?: number;
      poster_path: string | null;
      release_date?: string;
    }>;
  }>(`/find/${encodeURIComponent(externalId)}`, {
    external_source: "imdb_id",
    language: opts?.language,
  });
}

export async function tmdbDiscoverMovies(params: {
  page?: number;
  language?: string;
  sort_by?: string;
  with_genres?: string;
  primary_release_date_gte?: string;
  primary_release_date_lte?: string;
  with_original_language?: string;
  vote_average_gte?: number;
  vote_count_gte?: number;
  include_adult?: boolean;
}) {
  return tmdbGet<{ page: number; results: TmdbMovie[]; total_pages: number; total_results: number }>(
    "/discover/movie",
    {
      page: params.page ?? 1,
      language: params.language,
      sort_by: params.sort_by ?? "popularity.desc",
      with_genres: params.with_genres,
      "primary_release_date.gte": params.primary_release_date_gte,
      "primary_release_date.lte": params.primary_release_date_lte,
      with_original_language: params.with_original_language,
      "vote_average.gte": params.vote_average_gte,
      "vote_count.gte": params.vote_count_gte,
      include_adult: params.include_adult ?? false,
    }
  );
}

export async function tmdbGetMovieDetails(id: number, opts?: { language?: string }) {
  return tmdbGet<
    {
      id: number;
      title: string;
      tagline?: string;
      overview?: string;
      poster_path: string | null;
      backdrop_path: string | null;
      release_date?: string;
      runtime?: number;
      vote_average?: number;
      vote_count?: number;
      genres?: TmdbGenre[];
      original_language?: string;
    }
  >(`/movie/${id}`, { language: opts?.language });
}

export type TmdbCastMember = {
  id: number;
  name: string;
  character?: string;
  order?: number;
  profile_path: string | null;
};

export type TmdbCrewMember = {
  id: number;
  name: string;
  job?: string;
  department?: string;
  profile_path: string | null;
};

export type TmdbMovieCredits = {
  id: number;
  cast: TmdbCastMember[];
  crew: TmdbCrewMember[];
};

export async function tmdbGetMovieCredits(id: number, opts?: { language?: string }) {
  return tmdbGet<TmdbMovieCredits>(`/movie/${id}/credits`, { language: opts?.language });
}

export type WatchProvider = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
};

export type WatchProvidersResponse = {
  id: number;
  results: Record<
    string,
    {
      link?: string;
      flatrate?: WatchProvider[];
      rent?: WatchProvider[];
      buy?: WatchProvider[];
    }
  >;
};

export async function tmdbGetWatchProviders(id: number) {
  return tmdbGet<WatchProvidersResponse>(`/movie/${id}/watch/providers`, {});
}

export async function tmdbGetGenres(opts?: { language?: string }) {
  const res = await tmdbGet<{ genres: TmdbGenre[] }>("/genre/movie/list", { language: opts?.language });
  return res.genres;
}
