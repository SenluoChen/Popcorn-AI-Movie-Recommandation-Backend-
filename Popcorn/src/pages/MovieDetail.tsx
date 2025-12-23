import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";

import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import { getDefaultRegion } from "../utils/recommendMovies";
import {
  tmdbGetMovieCredits,
  tmdbGetMovieDetails,
  tmdbGetWatchProviders,
  tmdbImage,
  type TmdbCastMember,
  type TmdbCrewMember,
  type WatchProvider,
} from "../utils/tmdb";
import type { MovieRecommendation } from "../utils/recommendMovies";

type Media1000Item = {
  tmdbId: number;
  imdbId?: string | null;
  title?: string | null;
  posterUrl?: string | null;
  trailers?: Array<{ url?: string; name?: string; site?: string; type?: string; key?: string }>;
};

let media1000ByTmdbIdPromise: Promise<Map<number, Media1000Item>> | null = null;

async function loadMedia1000ByTmdbId(): Promise<Map<number, Media1000Item>> {
  if (media1000ByTmdbIdPromise) return media1000ByTmdbIdPromise;
  media1000ByTmdbIdPromise = (async () => {
    try {
      const resp = await fetch("/media_1000.json", { cache: "no-cache" });
      if (!resp.ok) return new Map();
      const data = await resp.json().catch(() => ({}));
      const raw = data?.byTmdbId && typeof data.byTmdbId === "object" ? data.byTmdbId : {};
      const map = new Map<number, Media1000Item>();
      for (const [k, v] of Object.entries(raw)) {
        const tmdbId = Number(k);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
        map.set(tmdbId, v as Media1000Item);
      }
      return map;
    } catch {
      return new Map();
    }
  })();
  return media1000ByTmdbIdPromise;
}

function firstNonEmpty<T>(arr: Array<T | null | undefined>): T | null {
  for (const v of arr) {
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

function tryGetYouTubeEmbedUrl(url: string | null | undefined): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const m1 = raw.match(/youtu\.be\/(.+?)(\?|$)/i);
  const m2 = raw.match(/[?&]v=([^&]+)/i);
  const m3 = raw.match(/youtube\.com\/embed\/([^?&/]+)/i);
  const id = String(m1?.[1] || m2?.[1] || m3?.[1] || "").trim();
  if (!id) return "";
  if (!/^[a-zA-Z0-9_-]{6,}$/.test(id)) return "";
  return `https://www.youtube.com/embed/${id}`;
}

function tryGetVimeoEmbedUrl(url: string | null | undefined): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const m1 = raw.match(/vimeo\.com\/(\d+)(\?|$)/i);
  const m2 = raw.match(/player\.vimeo\.com\/video\/(\d+)(\?|$)/i);
  const id = String(m1?.[1] || m2?.[1] || "").trim();
  if (!id) return "";
  if (!/^\d{6,}$/.test(id)) return "";
  return `https://player.vimeo.com/video/${id}`;
}

function tryGetEmbedUrl(url: string | null | undefined): string {
  return tryGetYouTubeEmbedUrl(url) || tryGetVimeoEmbedUrl(url) || "";
}

export default function MovieDetail() {
  const navigate = useNavigate();
  const { id } = useParams();

  const movieId = useMemo(() => Number(id), [id]);
  const region = useMemo(() => getDefaultRegion(), []);

  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [detail, setDetail] = useState<
    | null
    | {
        id: number;
        title: string;
        tagline?: string;
        overview?: string;
        poster_path: string | null;
        release_date?: string;
        runtime?: number;
        vote_average?: number;
        genres?: Array<{ id: number; name: string }>;
      }
  >(null);

  const [media, setMedia] = useState<Media1000Item | null>(null);
  const [cast, setCast] = useState<TmdbCastMember[]>([]);
  const [crew, setCrew] = useState<TmdbCrewMember[]>([]);

  const [watchLink, setWatchLink] = useState<string>("");
  const [flatrate, setFlatrate] = useState<WatchProvider[]>([]);
  const [rent, setRent] = useState<WatchProvider[]>([]);
  const [buy, setBuy] = useState<WatchProvider[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (!Number.isFinite(movieId) || movieId <= 0) {
      setError("Invalid movie id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    (async () => {
      try {
        const [d, credits, wp, mediaMap] = await Promise.all([
          tmdbGetMovieDetails(movieId, { language: "en-US" }),
          tmdbGetMovieCredits(movieId, { language: "en-US" }).catch(() => null),
          tmdbGetWatchProviders(movieId).catch(() => null),
          loadMedia1000ByTmdbId().catch(() => new Map<number, Media1000Item>()),
        ]);

        if (cancelled) return;

        setDetail(d);
        setCast(Array.isArray((credits as any)?.cast) ? (credits as any).cast : []);
        setCrew(Array.isArray((credits as any)?.crew) ? (credits as any).crew : []);

        const m = mediaMap.get(movieId) || null;
        setMedia(m);

        const regionBlock = firstNonEmpty([
          (wp as any)?.results?.[region],
          (wp as any)?.results?.US,
          (wp as any)?.results?.GB,
        ]);

        setWatchLink(String((regionBlock as any)?.link || ""));
        setFlatrate(Array.isArray((regionBlock as any)?.flatrate) ? (regionBlock as any).flatrate : []);
        setRent(Array.isArray((regionBlock as any)?.rent) ? (regionBlock as any).rent : []);
        setBuy(Array.isArray((regionBlock as any)?.buy) ? (regionBlock as any).buy : []);
      } catch (e: any) {
        if (cancelled) return;
        setError(String(e?.message || "Failed to load movie"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [movieId, region]);

  const year = useMemo(() => {
    const s = String(detail?.release_date || "").trim();
    return s ? s.slice(0, 4) : "";
  }, [detail?.release_date]);

  const directors = useMemo(() => {
    const names = (crew || [])
      .filter((m) => String(m?.job || "").toLowerCase() === "director")
      .map((m) => String(m?.name || "").trim())
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [crew]);

  const topCast = useMemo(() => {
    const sorted = [...(cast || [])].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    return sorted.slice(0, 12);
  }, [cast]);

  const pageBg = "var(--brand-900)";
  const surface = "var(--surface)";
  const border = "var(--border-1)";
  const muted = "var(--surface-muted)";

  const posterSrc = media?.posterUrl
    ? media.posterUrl
    : detail?.poster_path
      ? tmdbImage(detail.poster_path, "w500")
      : "";

  const trailerEmbedUrl = useMemo(() => {
    const trailers = Array.isArray(media?.trailers) ? media!.trailers! : [];
    for (const t of trailers) {
      const embed = tryGetEmbedUrl((t as any)?.url);
      if (embed) return embed;
    }
    return "";
  }, [media]);

  return (
    <>
      <Navbar
        query={query}
        setQuery={setQuery}
        onRecommend={(nextResults: MovieRecommendation[], usedQuery?: string) => {
          const q = String(usedQuery || query || "").trim();
          navigate(`/search?q=${encodeURIComponent(q)}`, { state: { results: nextResults, q } });
        }}
      />

      <div style={{ backgroundColor: pageBg, minHeight: "calc(100vh - 200px)" }}>
        <Container style={{ paddingTop: 18, paddingBottom: 24 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <IconButton
              onClick={() => navigate(-1)}
              aria-label="back"
              size="large"
              sx={{
                border: `1px solid ${border}`,
                backgroundColor: surface,
                borderRadius: 2,
              }}
            >
              <ArrowBackRoundedIcon />
            </IconButton>
            <Typography sx={{ color: "var(--text-invert)", fontWeight: 800 }}>Back</Typography>
          </Box>

          {loading ? (
            <Typography sx={{ color: muted }}>Loading…</Typography>
          ) : error ? (
            <Typography sx={{ color: "var(--danger-500)" }}>{error}</Typography>
          ) : !detail ? (
            <Typography sx={{ color: muted }}>Movie not found.</Typography>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "360px 1fr 360px" },
                gap: 3,
                alignItems: "start",
              }}
            >
              {/* Left: Poster */}
              <Box sx={{ width: { xs: "100%", md: 360 } }}>
                <Box
                  sx={{
                    width: "100%",
                    height: 520,
                    borderRadius: 2,
                    overflow: "hidden",
                    backgroundColor: surface,
                    border: `1px solid ${border}`,
                  }}
                >
                  {posterSrc ? (
                    <img
                      src={posterSrc}
                      alt={detail.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : null}
                </Box>
              </Box>

              {/* Middle: Main content */}
              <Box sx={{ minWidth: 0 }}>
                {trailerEmbedUrl ? (
                  <Box
                    sx={{
                      width: "100%",
                      borderRadius: 2,
                      overflow: "hidden",
                      backgroundColor: surface,
                      border: `1px solid ${border}`,
                      mb: 2,
                    }}
                  >
                    <Box sx={{ position: "relative", width: "100%", paddingTop: "56.25%" }}>
                      <iframe
                        title="Trailer"
                        src={trailerEmbedUrl}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          border: 0,
                        }}
                      />
                    </Box>
                  </Box>
                ) : null}

                <Typography variant="h4" sx={{ color: "var(--text-invert)", fontWeight: 900, letterSpacing: -0.3 }}>
                  {detail.title}{year ? ` (${year})` : ""}
                </Typography>
                {detail.tagline ? (
                  <Typography sx={{ mt: 1, color: muted, fontStyle: "italic" }}>{detail.tagline}</Typography>
                ) : null}

                <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap" }}>
                  {typeof detail.vote_average === "number" ? (
                    <Chip
                      label={`${detail.vote_average.toFixed(1)} ★`}
                      sx={{ backgroundColor: surface, color: "var(--text-invert)", border: `1px solid ${border}` }}
                    />
                  ) : null}
                  {typeof detail.runtime === "number" ? (
                    <Chip
                      label={`${detail.runtime} min`}
                      sx={{ backgroundColor: surface, color: "var(--text-invert)", border: `1px solid ${border}` }}
                    />
                  ) : null}
                  {directors.length ? (
                    <Chip
                      label={`Director: ${directors.slice(0, 2).join(", ")}`}
                      sx={{ backgroundColor: surface, color: "var(--text-invert)", border: `1px solid ${border}` }}
                    />
                  ) : null}
                </Stack>

                {Array.isArray(detail.genres) && detail.genres.length ? (
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }}>
                    {detail.genres.slice(0, 6).map((g) => (
                      <Chip
                        key={g.id}
                        label={g.name}
                        sx={{ backgroundColor: surface, color: "var(--text-invert)", border: `1px solid ${border}` }}
                      />
                    ))}
                  </Stack>
                ) : null}

                <Divider sx={{ my: 2, borderColor: border }} />

                <Typography sx={{ color: "var(--text-invert)", fontWeight: 800, mb: 1 }}>Overview</Typography>
                <Typography sx={{ color: muted, lineHeight: 1.7 }}>
                  {String(detail.overview || "").trim() ? detail.overview : "(Plot not available)"}
                </Typography>

                {topCast.length ? (
                  <>
                    <Divider sx={{ my: 2, borderColor: border }} />
                    <Typography sx={{ color: "var(--text-invert)", fontWeight: 800, mb: 1 }}>Cast</Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                      {topCast.map((m) => (
                        <Chip
                          key={m.id}
                          label={m.character ? `${m.name} — ${m.character}` : m.name}
                          sx={{ backgroundColor: surface, color: "var(--text-invert)", border: `1px solid ${border}` }}
                        />
                      ))}
                    </Stack>
                  </>
                ) : null}
              </Box>

              {/* Right: Where to watch (fixed 360px, never overlaps) */}
              <Box
                sx={{
                  width: { xs: "100%", md: 360 },
                  backgroundColor: surface,
                  border: `1px solid ${border}`,
                  borderRadius: 2,
                  p: 2,
                }}
              >
                <Typography sx={{ color: "var(--text-invert)", fontWeight: 900, mb: 1 }}>
                  Where to watch
                </Typography>

                {watchLink ? (
                  <Typography sx={{ color: muted, fontSize: 13, mb: 1 }}>
                    <a href={watchLink} target="_blank" rel="noreferrer" style={{ color: "var(--accent-500)" }}>
                      Open provider page
                    </a>
                  </Typography>
                ) : null}

                {flatrate.length || rent.length || buy.length ? (
                  <Stack spacing={2}>
                    {flatrate.length ? (
                      <Box>
                        <Typography sx={{ color: muted, fontWeight: 800, mb: 1 }}>Stream</Typography>
                        <ProviderRow providers={flatrate} />
                      </Box>
                    ) : null}
                    {rent.length ? (
                      <Box>
                        <Typography sx={{ color: muted, fontWeight: 800, mb: 1 }}>Rent</Typography>
                        <ProviderRow providers={rent} />
                      </Box>
                    ) : null}
                    {buy.length ? (
                      <Box>
                        <Typography sx={{ color: muted, fontWeight: 800, mb: 1 }}>Buy</Typography>
                        <ProviderRow providers={buy} />
                      </Box>
                    ) : null}
                  </Stack>
                ) : (
                  <Typography sx={{ color: muted, lineHeight: 1.6 }}>
                    No watch providers found for region: {region}
                  </Typography>
                )}
              </Box>
            </Box>
          )}
        </Container>
      </div>

      <Footer />
    </>
  );
}

function ProviderRow({ providers }: { providers: WatchProvider[] }) {
  const surface = "var(--surface)";
  const border = "var(--border-1)";
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
      {providers.slice(0, 18).map((p) => {
        const logo = p.logo_path ? tmdbImage(p.logo_path, "w185") : "";
        return (
          <Chip
            key={p.provider_id}
            label={p.provider_name}
            icon={
              logo ? (
                <img
                  src={logo}
                  alt={p.provider_name}
                  style={{ width: 18, height: 18, borderRadius: 4 }}
                />
              ) : undefined
            }
            sx={{ backgroundColor: surface, color: "var(--text-invert)", border: `1px solid ${border}` }}
          />
        );
      })}
    </Stack>
  );
}

function Container({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1200,
        margin: "0 auto",
        padding: "0 20px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
