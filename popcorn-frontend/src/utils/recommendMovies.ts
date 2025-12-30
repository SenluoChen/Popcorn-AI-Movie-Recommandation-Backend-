import { tmdbDiscoverMovies, tmdbSearchMovies, type TmdbMovie, tmdbGetGenres } from "./tmdb";

export type MovieRecommendation = {
  id: number;
  title: string;
  overview?: string;
  poster_path: string | null;
  imdbId?: string;
  // 小提醒：If present, this is a full URL (from our downloaded media manifest).
  posterUrl?: string | null;
  trailerUrl?: string | null;
  release_date?: string;
  original_language?: string;
  vote_average?: number;
  tagline?: string;
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function guessCountryFromLocale(locale?: string): string {
  const l = locale || (typeof navigator !== "undefined" ? navigator.language : "");
  const m = l.match(/-([a-zA-Z]{2})/);
  return (m?.[1] || "US").toUpperCase();
}

function extractYearRange(q: string): { gte?: string; lte?: string } {
  // 備註：examples: 2019, 2010s, 90s, 1990s
  const year = q.match(/(19\d{2}|20\d{2})/);
  if (year) {
    const y = Number(year[1]);
    return { gte: `${y}-01-01`, lte: `${y}-12-31` };
  }

  const decade = q.match(/(19\d0|20\d0)s/);
  if (decade) {
    const y = Number(decade[1]);
    return { gte: `${y}-01-01`, lte: `${y + 9}-12-31` };
  }

  return {};
}

function extractOriginalLanguage(q: string): string | undefined {
  const map: Array<[RegExp, string]> = [
    [/\b(japanese|jp)\b/i, "ja"],
    [/\b(korean|kr)\b/i, "ko"],
    [/\b(english|en)\b/i, "en"],
    [/\b(french|fr)\b/i, "fr"],
    [/\b(spanish|es)\b/i, "es"],
    [/\b(german|de)\b/i, "de"],
  ];
  for (const [re, code] of map) {
    if (re.test(q)) return code;
  }
  return undefined;
}

function keywordGenres(q: string): string[] {
  const rules: Array<[RegExp, string[]]> = [
    [/\b(horror)\b/i, ["Horror"]],
    [/\b(comedy)\b/i, ["Comedy"]],
    [/\b(romance)\b/i, ["Romance"]],
    [/\b(sci[- ]?fi|science fiction)\b/i, ["Science Fiction"]],
    [/\b(action)\b/i, ["Action"]],
    [/\b(mystery)\b/i, ["Mystery"]],
    [/\b(thriller)\b/i, ["Thriller"]],
    [/\b(animation|anime)\b/i, ["Animation"]],
    [/\b(family)\b/i, ["Family"]],
    [/\b(crime)\b/i, ["Crime"]],
    [/\b(war)\b/i, ["War"]],
    [/\b(documentary)\b/i, ["Documentary"]],
    [/\b(music)\b/i, ["Music"]],
    [/\b(adventure)\b/i, ["Adventure"]],
    [/\b(fantasy)\b/i, ["Fantasy"]],
  ];

  const names = new Set<string>();
  for (const [re, genreNames] of rules) {
    if (re.test(q)) genreNames.forEach((g) => names.add(g));
  }
  return Array.from(names);
}

async function mapGenreNamesToIds(genreNames: string[], language?: string): Promise<string | undefined> {
  if (!genreNames.length) return undefined;
  const genres = await tmdbGetGenres({ language });
  const byName = new Map(genres.map((g) => [normalize(g.name), g.id] as const));
  const ids = genreNames
    .map((n) => byName.get(normalize(n)))
    .filter((v): v is number => typeof v === "number");
  return ids.length ? ids.join(",") : undefined;
}

function looksLikeTitleSearch(q: string) {
  // 提醒：If user uses quotes or explicitly says it's a title search.
  return /["“”]/.test(q) || /\b(title|movie name)\b/i.test(q);
}

function asRecommendations(movies: TmdbMovie[]): MovieRecommendation[] {
  return movies.map((m) => ({
    id: m.id,
    title: m.title,
    overview: m.overview,
    poster_path: m.poster_path,
    release_date: m.release_date,
    original_language: m.original_language,
    vote_average: m.vote_average,
  }));
}

export async function recommendMovies(nlQuery: string, opts?: { language?: string; region?: string; limit?: number }) {
  const q = nlQuery.trim();
  if (!q) return [] as MovieRecommendation[];

  const language = opts?.language ?? "en-US";

  // 說明：1) If it looks like a title query, prioritize /search
  if (looksLikeTitleSearch(q) || q.length <= 18) {
    const sr = await tmdbSearchMovies(q.replace(/["“”]/g, ""), { language, page: 1, include_adult: false });
    return asRecommendations(sr.results.slice(0, opts?.limit ?? 12));
  }

  // 說明：2) Structured discover using simple keyword extraction
  const yr = extractYearRange(q);
  const lang = extractOriginalLanguage(q);
  const genreNames = keywordGenres(q);
  const withGenres = await mapGenreNamesToIds(genreNames, language);

  const dr = await tmdbDiscoverMovies({
    language,
    page: 1,
    sort_by: "popularity.desc",
    with_genres: withGenres,
    primary_release_date_gte: yr.gte,
    primary_release_date_lte: yr.lte,
    with_original_language: lang,
    vote_count_gte: 50,
    include_adult: false,
  });

  const recs = dr.results;

  // 提醒：3) If discover comes back too thin, fallback to /search
  if (recs.length < 4) {
    const sr = await tmdbSearchMovies(q, { language, page: 1, include_adult: false });
    return asRecommendations(sr.results.slice(0, opts?.limit ?? 12));
  }

  return asRecommendations(recs.slice(0, opts?.limit ?? 12));
}

export function getDefaultRegion(): string {
  return guessCountryFromLocale(typeof navigator !== "undefined" ? navigator.language : undefined);
}
