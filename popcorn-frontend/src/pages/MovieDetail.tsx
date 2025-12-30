import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import Navbar from "../components/Navbar";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import Footer from "../components/footer";
import { getDefaultRegion } from "../utils/recommendMovies";
import type { MovieRecommendation } from "../utils/recommendMovies";
import {
  tmdbGetMovieCredits,
  tmdbGetMovieDetails,
  tmdbGetWatchProviders,
  tmdbImage,
  type TmdbMovieCredits,
  type WatchProvider,
  type WatchProvidersResponse,
} from "../utils/tmdb";
import { MEDIA_HEIGHTS, MEDIA_GRID_COLUMNS, DETAILS_GRID_COLUMNS } from "../config/ui";

type Media1000Trailer = { url?: string; name?: string; site?: string; type?: string; key?: string };

type Media1000Item = {
  tmdbId?: number;
  imdbId?: string;
  title?: string;
  year?: string;
  posterUrl?: string;
  trailers?: Media1000Trailer[];
};

let MEDIA1000_BY_TMDB_ID_PROMISE: Promise<Map<number, Media1000Item>> | null = null;

async function loadMedia1000ByTmdbId(): Promise<Map<number, Media1000Item>> {
  if (MEDIA1000_BY_TMDB_ID_PROMISE) return MEDIA1000_BY_TMDB_ID_PROMISE;

  MEDIA1000_BY_TMDB_ID_PROMISE = (async () => {
    const res = await fetch("/media_1000.json");
    if (!res.ok) throw new Error(`Failed to load media_1000.json (${res.status})`);
    const json = (await res.json()) as any;
    const byTmdbId = (json && typeof json === "object" ? json.byTmdbId : null) || {};

    const map = new Map<number, Media1000Item>();
    for (const [k, v] of Object.entries(byTmdbId)) {
      const id = Number(k);
      if (!Number.isFinite(id) || id <= 0) continue;
      map.set(id, v as Media1000Item);
    }
    return map;
  })();

  return MEDIA1000_BY_TMDB_ID_PROMISE;
}

function tryGetYouTubeEmbedUrl(url: string | null | undefined): string {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();

    // youtu.be/<id>
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\/+/, "").split("/")[0] || "";
      if (/^[a-zA-Z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
    }

    // youtube.com/watch?v=<id>
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v") || "";
      if (/^[a-zA-Z0-9_-]{6,}$/.test(v)) return `https://www.youtube.com/embed/${v}`;

      // youtube.com/embed/<id>
      const parts = u.pathname.split("/").filter(Boolean);
      const embedIdx = parts.findIndex((p) => p === "embed");
      if (embedIdx >= 0) {
        const id = parts[embedIdx + 1] || "";
        if (/^[a-zA-Z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
      }
    }

    return "";
  } catch {
    return "";
  }
}

function tryGetVimeoEmbedUrl(url: string | null | undefined): string {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();

    // vimeo.com/<id>
    if (host.endsWith("vimeo.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const id = (host.startsWith("player.") ? parts[1] : parts[0]) || "";
      if (/^\d{6,}$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }

    return "";
  } catch {
    return "";
  }
}

function tryGetEmbedUrl(url: string | null | undefined): string {
  return tryGetYouTubeEmbedUrl(url) || tryGetVimeoEmbedUrl(url) || "";
}

type DetailTab = "overview" | "cast" | "details";

export default function MovieDetail() {
  const navigate = useNavigate();
  const { id } = useParams();

  const movieId = useMemo(() => Number(id), [id]);
  const region = useMemo(() => getDefaultRegion(), []);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [detail, setDetail] = useState<Awaited<ReturnType<typeof tmdbGetMovieDetails>> | null>(null);
  const [media, setMedia] = useState<Media1000Item | null>(null);

  const [credits, setCredits] = useState<TmdbMovieCredits | null>(null);
  const [watchProviders, setWatchProviders] = useState<WatchProvidersResponse | null>(null);

  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const tabContentRef = useRef<HTMLDivElement>(null);
  const detailsMeasureRef = useRef<HTMLDivElement>(null);
  const [detailsTabMinHeight, setDetailsTabMinHeight] = useState<number>(0);

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
        const [d, c, wp, mediaMap] = await Promise.all([
          tmdbGetMovieDetails(movieId, { language: "en-US" }),
          tmdbGetMovieCredits(movieId, { language: "en-US" }).catch(() => null),
          tmdbGetWatchProviders(movieId).catch(() => null),
          loadMedia1000ByTmdbId().catch(() => new Map<number, Media1000Item>()),
        ]);

        if (cancelled) return;

        setDetail(d);
        setCredits(c);
        setWatchProviders(wp);
        setMedia(mediaMap.get(movieId) || null);
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
  }, [movieId]);

  const year = useMemo(() => {
    const s = String(detail?.release_date || "").trim();
    return s ? s.slice(0, 4) : "";
  }, [detail?.release_date]);

  const detailsRows = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    const release = String(detail?.release_date || "").trim();
    if (release) rows.push({ label: "Release", value: release });

    const lang = String(detail?.original_language || "").trim();
    if (lang) rows.push({ label: "Language", value: lang.toUpperCase() });

    const votes = typeof detail?.vote_count === "number" && Number.isFinite(detail.vote_count)
      ? detail.vote_count
      : null;
    if (votes != null) rows.push({ label: "Votes", value: votes.toLocaleString() });

    return rows;
  }, [detail?.release_date, detail?.original_language, detail?.vote_count]);

  const genreCount = useMemo(() => (detail?.genres?.length ?? 0), [detail]);

  

  const topCast = useMemo(() => {
    const sorted = [...(credits?.cast || [])].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    return sorted.slice(0, 12);
  }, [credits]);

  const regionBlock = useMemo(() => {
    const results = watchProviders?.results || {};
    return results[region] || results.US || results.GB || null;
  }, [watchProviders, region]);

  const flatrate = Array.isArray(regionBlock?.flatrate) ? regionBlock!.flatrate! : [];
  const rent = Array.isArray(regionBlock?.rent) ? regionBlock!.rent! : [];
  const buy = Array.isArray(regionBlock?.buy) ? regionBlock!.buy! : [];

  const pageBg = "var(--brand-900)";
  const surface = "var(--surface)";
  const border = "var(--border-1)";
  const muted = "var(--surface-muted)";
  const blockSx = {
    backgroundColor: "transparent",
    border: "none",
    borderRadius: 0,
    p: 0,
  } as any;

  // Genre capsule style helper: no hard-coded colors; use existing CSS variables.
  const genreCapsuleSx = (name: string) => {
    const key = String(name || "").trim().toLowerCase();
    const angles: Record<string, number> = {
      horror: 135,
      thriller: 225,
      action: 45,
      adventure: 315,
    };
    const angle = angles[key] ?? 135;

    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      px: 1.75,
      py: 0.7,
      pl: 4,
      borderRadius: 999,
      minHeight: 32,
      border: `1px solid ${border}`,
      backgroundColor: surface,
      backgroundImage: `linear-gradient(${angle}deg, var(--surface) 0%, var(--surface) 55%, var(--surface-muted) 100%)`,
      boxShadow: "var(--shadow-1)",
      color: "var(--text-invert)",
      fontWeight: 950,
      fontSize: 13.5,
      letterSpacing: 0.5,
      lineHeight: 1,
      userSelect: "none",
      "&::before": {
        content: '""',
        position: "absolute",
        left: 14,
        top: "50%",
        transform: "translateY(-50%)",
        width: 8,
        height: 8,
        borderRadius: 999,
        backgroundColor: "var(--accent-500)",
        boxShadow: "0 0 0 2px var(--surface)",
      },
      "&::after": {
        content: '""',
        position: "absolute",
        inset: 1,
        borderRadius: 999,
        border: "1px solid var(--border-1)",
        opacity: 0.55,
        pointerEvents: "none",
      },
    } as any;
  };

  const posterSrc = useMemo(() => {
    if (media?.posterUrl) return media.posterUrl;
    if (detail?.poster_path) return tmdbImage(detail.poster_path, "w500");
    return "";
  }, [media?.posterUrl, detail?.poster_path]);

  const trailerEmbedUrl = useMemo(() => {
    const trailers = Array.isArray(media?.trailers) ? media!.trailers! : [];
    for (const t of trailers) {
      const embed = tryGetEmbedUrl(t?.url);
      if (embed) return embed;
    }
    return "";
  }, [media]);

  const backdropSrc = useMemo(() => {
    if (detail?.backdrop_path) return tmdbImage(detail.backdrop_path, "original");
    return "";
  }, [detail?.backdrop_path]);

  // Larger media sizes for detail view (override of central UI sizes)
  const ENLARGE_SCALE = 1.35;
  const largeHeights = {
    xs: Math.round(MEDIA_HEIGHTS.xs * ENLARGE_SCALE),
    sm: Math.round(MEDIA_HEIGHTS.sm * ENLARGE_SCALE),
    md: Math.round(MEDIA_HEIGHTS.md * ENLARGE_SCALE),
  };
  // Keep trailer flexible, but give the poster a more natural desktop width
  const mediaGridColumns = { xs: MEDIA_GRID_COLUMNS.xs, md: "minmax(320px, 440px) 1fr" };
  const detailsGridColumnsLocal = { xs: DETAILS_GRID_COLUMNS.xs, md: "1fr 340px" };

  const bodyTextScaleSx = {
                        width: "100%",
    "& .MuiTypography-body2": { fontSize: { xs: "1.08rem", md: "1.18rem" } },
    "& .MuiTypography-subtitle1": { fontSize: { xs: "1.12rem", md: "1.28rem" } },
    "& .MuiTypography-subtitle2": { fontSize: { xs: "1.08rem", md: "1.18rem" } },
    "& .MuiTypography-caption": { fontSize: { xs: "1.0rem", md: "1.08rem" } },
  } as const;

  const ratingText = useMemo(() => {
    const v = detail?.vote_average;
    if (typeof v !== "number" || !Number.isFinite(v)) return "";
    return v.toFixed(1);
  }, [detail?.vote_average]);

  const setTab = (tab: DetailTab) => {
    setActiveTab(tab);
  };

  // Keep footer spacing stable across tab switches by locking the tab-content area's
  // minHeight to the rendered height of the Details tab (the “largest” baseline).
  useLayoutEffect(() => {
    const el = detailsMeasureRef.current;
    if (!el) return;

    const measure = () => {
      const next = Math.ceil(el.getBoundingClientRect().height);
      if (next > 0 && next !== detailsTabMinHeight) setDetailsTabMinHeight(next);
    };

    measure();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }

    // Fonts/images can affect layout after first paint
    const raf = requestAnimationFrame(measure);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [detail, detailsRows.length, genreCount, detailsTabMinHeight]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", backgroundColor: pageBg }}>
      <Navbar
        query={query}
        setQuery={setQuery}
        onRecommend={(nextResults: MovieRecommendation[], usedQuery?: string) => {
          const q = String(usedQuery || query || "").trim();
          navigate(`/search?q=${encodeURIComponent(q)}`, { state: { results: nextResults, q } });
        }}
      />

      <div style={{ flex: 1 }}>
        <Box sx={{ position: "relative", display: "flex", flexDirection: "column", minHeight: "100%" }}>
          {backdropSrc ? (
            <Box
              aria-hidden="true"
              sx={{
                position: "absolute",
                inset: 0,
                height: { xs: 260, sm: 320, md: 380 },
                backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.68), ${pageBg}), url(${backdropSrc})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(10px) saturate(1.05) brightness(0.60)",
                transform: "scale(1.06)",
                pointerEvents: "none",
              }}
            />
          ) : null}

          <Box sx={{ backgroundColor: "rgba(0,0,0,0.42)", position: "relative" }}>
          <Container style={{ paddingTop: 18, paddingBottom: 64, position: "relative" }}>
          <Box sx={{ ...bodyTextScaleSx }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <IconButton
              onClick={() => navigate(-1)}
              aria-label="go back"
              size="large"
              sx={{
                border: `1px solid ${border}`,
                backgroundColor: surface,
                borderRadius: 999,
                color: "var(--text-invert)",
                width: 46,
                height: 46,
                boxShadow: "var(--shadow-1)",
                "& svg": { fontSize: 30 },
              }}
            >
              <ArrowBackRoundedIcon />
            </IconButton>
          </Box>

          {loading ? (
            <Typography sx={{ color: muted }}>Loading</Typography>
          ) : error ? (
            <Typography sx={{ color: "var(--danger-500)" }}>{error}</Typography>
          ) : !detail ? (
            <Typography sx={{ color: muted }}>Movie not found.</Typography>
          ) : (
            <Stack spacing={3}>
              <Box sx={{ display: "grid", gridTemplateColumns: mediaGridColumns as any, gap: 3, alignItems: "stretch" }}>
                <Box
                  sx={{
                    width: "100%",
                    height: { xs: largeHeights.xs, sm: largeHeights.sm, md: largeHeights.md },
                    borderRadius: 2,
                    overflow: "hidden",
                    backgroundColor: surface,
                    border: `1px solid ${border}`,
                  }}
                >
                  {posterSrc ? (
                    <img src={posterSrc} alt={detail.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
                      <Typography sx={{ color: muted, fontWeight: 700 }}>Poster not available</Typography>
                    </Box>
                  )}
                </Box>

                <Box
                  sx={{
                    width: "100%",
                    height: { xs: largeHeights.xs, sm: largeHeights.sm, md: largeHeights.md },
                    borderRadius: 2,
                    overflow: "hidden",
                    backgroundColor: surface,
                    border: `1px solid ${border}`,
                  }}
                >
                  {trailerEmbedUrl ? (
                    <iframe
                      title="Trailer"
                      src={trailerEmbedUrl}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ width: "100%", height: "100%", border: 0 }}
                    />
                  ) : (
                    <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
                      <Typography sx={{ color: muted, fontWeight: 700 }}>Trailer not available</Typography>
                    </Box>
                  )}
                </Box>
              </Box>

              <Box sx={{ borderRadius: 2, px: 0, py: { xs: 1.5, md: 2 } }}>
                <Box sx={{ display: "grid", gridTemplateColumns: detailsGridColumnsLocal as any, gap: 3 }}>
                  <Box
                    sx={{
                      minWidth: 0,
                      backgroundColor: surface,
                      border: `1px solid ${border}`,
                      borderRadius: 2,
                      p: { xs: 2, md: 3 },
                      pt: { md: 1 },
                    }}
                  >
                  <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
                    <Typography variant="h4" sx={{ color: "var(--text-invert)", fontWeight: 950, letterSpacing: -0.4, lineHeight: 1.02, minWidth: 0, fontSize: { xs: 26, md: 42 } }}>
                      {detail.title}{year ? ` (${year})` : ""}
                    </Typography>

                    {ratingText ? (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flex: "0 0 auto" }} aria-label={`Rating ${ratingText}`}>
                        <Typography
                          sx={{
                            color: "var(--text-invert)",
                            fontWeight: 950,
                            fontSize: { xs: 26, md: 38 },
                            lineHeight: 1,
                          }}
                        >
                          {ratingText}
                        </Typography>
                        <StarRoundedIcon sx={{ color: "var(--rating-gold)", fontSize: { xs: 38, md: 48 } }} />
                      </Box>
                    ) : null}
                  </Box>

                  {/* Single-line meta: YEAR | LANG | TAGLINE */}
                  <Typography sx={{ mt: 0.75, color: "var(--surface-muted)", fontWeight: 800, fontSize: { xs: 17, md: 20 }, letterSpacing: 0.2, lineHeight: 1.5 }}>
                    {year ? <Box component="span">{year}</Box> : null}
                    {year && String(detail?.original_language || "").trim() ? <Box component="span" sx={{ mx: 1 }}>|</Box> : null}
                    {String(detail?.original_language || "").trim() ? (
                      <Box component="span">{String(detail!.original_language).toUpperCase()}</Box>
                    ) : null}
                    {detail.tagline ? <Box component="span" sx={{ mx: 1 }}>|</Box> : null}
                    {detail.tagline ? (
                      <Box component="span" sx={{ color: muted, fontStyle: "italic", fontWeight: 600 }}>
                        {detail.tagline}
                      </Box>
                    ) : null}
                  </Typography>

                  {/* Section tabs (click to reveal content) */}
                  <Box
                    role="tablist"
                    aria-label="Movie detail sections"
                    sx={{
                      mt: 2,
                      display: "flex",
                      alignItems: "center",
                      gap: { xs: 3, md: 4 },
                      borderBottom: `1px solid ${border}`,
                      overflowX: "auto",
                      WebkitOverflowScrolling: "touch",
                      pb: 1,
                    }}
                  >
                    {(
                      [
                        { key: "overview", label: "OVERVIEW" },
                        { key: "cast", label: "CAST" },
                        { key: "details", label: "DETAILS" },
                      ] as Array<{ key: DetailTab; label: string }>
                    ).map((t) => {
                      const isActive = activeTab === t.key;
                      return (
                        <Box
                          key={t.key}
                          role="tab"
                          aria-selected={isActive}
                          tabIndex={0}
                          onClick={() => setTab(t.key)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setTab(t.key);
                            }
                          }}
                          sx={{
                            cursor: "pointer",
                            userSelect: "none",
                            px: { xs: 1, md: 1.5 },
                            py: { xs: 0.75, md: 1 },
                            borderBottom: isActive ? `4px solid var(--accent-500)` : "4px solid transparent",
                            color: isActive ? "var(--text-invert)" : "var(--surface-muted)",
                            fontWeight: 950,
                            fontSize: { xs: 16, md: 18 },
                            letterSpacing: 1,
                            whiteSpace: "nowrap",
                            transition: "color 140ms ease, border-color 140ms ease",
                            "&:hover": {
                              color: "var(--text-invert)",
                            },
                            "&:focus-visible": {
                              outline: `2px solid var(--accent-500)`,
                              outlineOffset: "3px",
                              borderRadius: 1,
                            },
                          }}
                        >
                          {t.label}
                        </Box>
                      );
                    })}
                  </Box>

                  {/* Tab contents (hidden unless selected) */}
                  <Box
                    ref={tabContentRef}
                    sx={{
                      mt: 3,
                      scrollMarginTop: "96px",
                      position: "relative",
                      minHeight: detailsTabMinHeight ? `${detailsTabMinHeight}px` : undefined,
                    }}
                  >
                    {/* Hidden measurer: renders Details content off-screen to lock minHeight */}
                    <Box
                      ref={detailsMeasureRef}
                      aria-hidden="true"
                      sx={{
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        visibility: "hidden",
                        height: "fit-content",
                      }}
                    >
                      {/* Details baseline */}
                      {Array.isArray(detail?.genres) && detail.genres.length ? (
                        <Box sx={{ ...blockSx }}>
                          <Typography sx={{ color: muted, fontWeight: 900, fontSize: { xs: 18, md: 20 }, letterSpacing: 0.6, textTransform: "uppercase" }}>
                            Genres
                          </Typography>
                          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
                            {detail.genres.slice(0, 10).map((g) => (
                              <Box
                                component="span"
                                key={g.id}
                                sx={{
                                  ...genreCapsuleSx(g.name || ""),
                                  mr: 0.5,
                                  mb: 0.5,
                                }}
                              >
                                {g.name}
                              </Box>
                            ))}
                          </Stack>
                        </Box>
                      ) : null}

                      {detailsRows.length ? (
                        <Box sx={{ mt: 2 }}>
                          <Typography sx={{ color: muted, fontWeight: 900, fontSize: { xs: 18, md: 20 }, letterSpacing: 0.6, textTransform: "uppercase" }}>
                            Details
                          </Typography>
                          <Box
                            sx={{
                              mt: 1,
                              display: "grid",
                              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                              gap: 2,
                            }}
                          >
                            {detailsRows.map((r) => (
                              <Box key={r.label} sx={{ display: "flex", flexDirection: "column", gap: 0.5, p: 0.5 }}>
                                <Typography sx={{ color: muted, fontSize: { xs: 12, md: 12 }, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                  {r.label}
                                </Typography>
                                <Typography sx={{ color: "var(--text-invert)", fontWeight: 900, fontSize: { xs: 18, md: 20 }, lineHeight: 2 }}>
                                  {r.value}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      ) : null}
                    </Box>

                    {activeTab === "overview" ? (
                      <>
                        {/* runtime and director display removed per request */}

                        <Box sx={{ ...blockSx, mt: 1.5, alignSelf: 'start' }}>
                          <Box sx={{ width: '100%', pr: 0 }}>
                            <Typography sx={{ color: "var(--text-invert)", fontWeight: 950, mb: 1, fontSize: { xs: 18, md: 22 } }}>
                              Overview
                            </Typography>
                            <Typography sx={{ color: muted, lineHeight: 2.05, whiteSpace: "pre-wrap", fontSize: { xs: 18, md: 20 } }}>
                              {String(detail.overview || "").trim() ? detail.overview : "(Plot not available)"}
                            </Typography>
                          </Box>
                        </Box>
                      </>
                    ) : null}

                    {activeTab === "cast" ? (
                      topCast.length ? (
                        <>
                          <Typography sx={{ color: "var(--text-invert)", fontWeight: 950, mb: 1, fontSize: { xs: 18, md: 20 } }}>
                            Cast
                          </Typography>

                          <Box sx={{ ...blockSx }}>
                            <Slider
                              dots={false}
                              infinite={false}
                              speed={400}
                              slidesToShow={4}
                              slidesToScroll={1}
                              arrows={true}
                              responsive={[
                                { breakpoint: 1200, settings: { slidesToShow: 3 } },
                                { breakpoint: 900, settings: { slidesToShow: 2 } },
                                { breakpoint: 600, settings: { slidesToShow: 1 } },
                              ]}
                            >
                              {topCast.slice(0, 12).map((m) => (
                                <div key={m.id} style={{ padding: "6px" }}>
                                  <Box
                                    sx={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 1,
                                      border: `1px solid ${border}`,
                                      borderRadius: 2,
                                      p: 1,
                                      backgroundColor: "transparent",
                                      minWidth: 0,
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: 84,
                                        height: 84,
                                        borderRadius: 10,
                                        overflow: "hidden",
                                        background: surface,
                                        flex: "0 0 84px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      {m.profile_path ? (
                                        <img
                                          src={tmdbImage(m.profile_path, "w342")}
                                          alt={m.name}
                                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                        />
                                      ) : (
                                        <div
                                          style={{
                                            width: "100%",
                                            height: "100%",
                                            display: "grid",
                                            placeItems: "center",
                                            color: "var(--text-invert)",
                                            fontSize: 14,
                                          }}
                                        >
                                          {m.name
                                            .split(" ")
                                            .map((n) => n[0])
                                            .slice(0, 2)
                                            .join("")}
                                        </div>
                                      )}
                                    </div>

                                    <div style={{ minWidth: 0 }}>
                                      <Typography sx={{ color: "var(--text-invert)", fontWeight: 900, lineHeight: 1.2 }} noWrap>
                                        {m.name}
                                      </Typography>
                                      {m.character ? (
                                        <Typography sx={{ color: muted, fontSize: 13, mt: 0.25, lineHeight: 1.4 }} noWrap>
                                          {m.character}
                                        </Typography>
                                      ) : (
                                        <Typography sx={{ color: muted, fontSize: 13, mt: 0.25, lineHeight: 1.4 }}>
                                          {"\u00A0"}
                                        </Typography>
                                      )}
                                    </div>
                                  </Box>
                                </div>
                              ))}
                            </Slider>
                          </Box>
                        </>
                      ) : (
                        <Typography sx={{ color: muted, lineHeight: 1.6 }}>
                          Cast not available.
                        </Typography>
                      )
                    ) : null}

                    {activeTab === "details" ? (
                      <>
                        {Array.isArray(detail.genres) && detail.genres.length ? (
                          <Box sx={{ ...blockSx }}>
                            <Typography sx={{ color: muted, fontWeight: 900, fontSize: { xs: 18, md: 20 }, letterSpacing: 0.6, textTransform: "uppercase" }}>
                              Genres
                            </Typography>
                            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
                              {detail.genres.slice(0, 10).map((g) => (
                                <Box
                                  component="span"
                                  key={g.id}
                                  sx={{
                                    ...genreCapsuleSx(g.name || ""),
                                    mr: 0.5,
                                    mb: 0.5,
                                  }}
                                >
                                  {g.name}
                                </Box>
                              ))}
                            </Stack>
                          </Box>
                        ) : null}

                        {detailsRows.length ? (
                          <Box sx={{ mt: 2 }}>
                            <Typography sx={{ color: muted, fontWeight: 900, fontSize: { xs: 18, md: 20 }, letterSpacing: 0.6, textTransform: "uppercase" }}>
                              Details
                            </Typography>
                            <Box
                              sx={{
                                mt: 1,
                                display: "grid",
                                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                                gap: 2,
                              }}
                            >
                              {detailsRows.map((r) => (
                                <Box key={r.label} sx={{ display: "flex", flexDirection: "column", gap: 0.5, p: 0.5 }}>
                                  <Typography sx={{ color: muted, fontSize: { xs: 12, md: 12 }, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                    {r.label}
                                  </Typography>
                                  <Typography sx={{ color: "var(--text-invert)", fontWeight: 900, fontSize: { xs: 18, md: 20 }, lineHeight: 2 }}>
                                    {r.value}
                                  </Typography>
                                </Box>
                              ))}
                            </Box>
                          </Box>
                        ) : null}
                      </>
                    ) : null}
                  </Box>

                  

                  
                </Box>

                  <Box
                    sx={{
                      width: "100%",
                      justifySelf: "stretch",
                      background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
                      boxSizing: "border-box",
                      borderRadius: 2,
                      border: `1px solid ${border}`,
                      boxShadow: "none",
                      overflow: "hidden",
                      position: "relative",
                      "&::after": {
                        content: '""',
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
                      },
                      p: { xs: 2, md: 3 },
                      alignSelf: "start",
                      mt: 0,
                    }}
                  >
                    <Typography sx={{ color: "var(--text-invert)", fontWeight: 900, mb: 1 }}>Where to watch</Typography>

                    <Divider sx={{ mb: 2, borderColor: "rgba(255,255,255,0.06)" }} />

                    {flatrate.length || rent.length || buy.length ? (
                      <Stack spacing={2}>
                        {flatrate.length ? (
                          <Box>
                            <Typography sx={{ color: muted, fontWeight: 800, mb: 1, fontSize: { xs: 18, md: 20 } }}>Stream</Typography>
                            {regionBlock?.link ? (
                              <div style={{ marginBottom: 8 }}>
                                <a href={String(regionBlock.link)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--surface-muted)', fontSize: 13 }}>
                                  Open provider options on TMDb
                                </a>
                              </div>
                            ) : null}
                            <ProviderRow providers={flatrate} tileSize={56} providerLink={regionBlock?.link} />
                          </Box>
                        ) : null}
                        {flatrate.length && (rent.length || buy.length) ? (
                          <Divider sx={{ borderColor: "rgba(255,255,255,0.06)" }} />
                        ) : null}
                        {rent.length ? (
                          <Box>
                            <Typography sx={{ color: muted, fontWeight: 800, mb: 1, fontSize: { xs: 18, md: 20 } }}>Rent</Typography>
                            {regionBlock?.link ? (
                              <div style={{ marginBottom: 8 }}>
                                <a href={String(regionBlock.link)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--surface-muted)', fontSize: 13 }}>
                                  Open provider options on TMDb
                                </a>
                              </div>
                            ) : null}
                            <ProviderRow providers={rent} tileSize={56} providerLink={regionBlock?.link} />
                          </Box>
                        ) : null}
                        {rent.length && buy.length ? <Divider sx={{ borderColor: "rgba(255,255,255,0.06)" }} /> : null}
                        {buy.length ? (
                          <Box>
                            <Typography sx={{ color: muted, fontWeight: 800, mb: 1, fontSize: { xs: 18, md: 20 } }}>Buy</Typography>
                            {regionBlock?.link ? (
                              <div style={{ marginBottom: 8 }}>
                                <a href={String(regionBlock.link)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--surface-muted)', fontSize: 13 }}>
                                  Open provider options on TMDb
                                </a>
                              </div>
                            ) : null}
                            <ProviderRow providers={buy} tileSize={56} providerLink={regionBlock?.link} />
                          </Box>
                        ) : null}
                      </Stack>
                    ) : (
                      <Typography sx={{ color: muted, lineHeight: 1.6 }}>No watch providers found for region: {region}</Typography>
                    )}
                  </Box>
                </Box>
              </Box>
            </Stack>
          )}
          </Box>
          </Container>
          </Box>
        </Box>
      </div>

      <Footer />
    </div>
  );
}

function ProviderRow({ providers, tileSize, providerLink }: { providers: WatchProvider[]; tileSize?: number; providerLink?: string | null }) {
  const surface = "var(--surface)";
  const border = "var(--border-1)";
  const size = typeof tileSize === "number" && tileSize > 0 ? tileSize : 44;
  // Render as uniform square icon tiles for consistent alignment
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {providers.slice(0, 18).map((p) => {
        const logo = p.logo_path ? tmdbImage(p.logo_path, "w185") : "";
        const tile = (
          <div
            key={p.provider_id}
            title={p.provider_name}
            style={{
              width: size,
              height: size,
              borderRadius: 8,
              background: surface,
              border: `1px solid ${border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {logo ? (
              <img src={logo} alt={p.provider_name} style={{ maxWidth: "80%", maxHeight: "80%", objectFit: "contain" }} />
            ) : (
              <div style={{ fontSize: Math.max(11, Math.round(size / 6)), color: "var(--text-invert)", textAlign: "center", padding: 4 }}>{p.provider_name}</div>
            )}
          </div>
        );

        // If TMDb provides a region-level link for the movie, use that as the tile link.
        if (providerLink) {
          return (
            <a key={p.provider_id} href={String(providerLink)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
              {tile}
            </a>
          );
        }

        return tile;
      })}
    </div>
  );
}

function Container({ children, style = {} }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1680,
        margin: "0 auto",
        padding: "0 24px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
