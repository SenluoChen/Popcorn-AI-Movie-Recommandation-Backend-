// note: src/pages/HomePage.tsx
import { useEffect, useMemo, useState } from "react";
import "../App.css";
import { useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import type { MovieRecommendation } from "../utils/recommendMovies";
import { tmdbGetMovieDetails } from "../utils/tmdb";

type LocalTop10Item = {
  imdbId: string;
  title?: string;
  posterUrl?: string | null;
  backdropUrls?: string[];
  trailers?: Array<{ url?: string; name?: string; site?: string; type?: string; key?: string }>;
};

async function loadLocalTop10(): Promise<LocalTop10Item[]> {
  try {
    const resp = await fetch("/media_top10.json", { cache: "no-cache" });
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => ({}));
    const items: LocalTop10Item[] = Array.isArray(data?.items) ? data.items : [];
    return items.filter((x) => x && String(x.imdbId || "").trim()).slice(0, 10);
  } catch {
    return [];
  }
}

type Media1000Item = {
  tmdbId: number;
  imdbId?: string | null;
};

let imdbToTmdbIdPromise: Promise<Map<string, number>> | null = null;
async function loadImdbToTmdbId(): Promise<Map<string, number>> {
  if (imdbToTmdbIdPromise) return imdbToTmdbIdPromise;

  imdbToTmdbIdPromise = (async () => {
    try {
      const resp = await fetch("/media_1000.json", { cache: "no-cache" });
      if (!resp.ok) return new Map();

      const data = await resp.json().catch(() => ({}));
      const byTmdbId: Record<string, Media1000Item> =
        data && typeof data === "object" && data.byTmdbId && typeof data.byTmdbId === "object" ? data.byTmdbId : {};

      const out = new Map<string, number>();
      Object.values(byTmdbId).forEach((v) => {
        const imdb = String(v?.imdbId || "").trim();
        const tmdbId = typeof v?.tmdbId === "number" ? v.tmdbId : Number((v as any)?.tmdbId);
        if (!imdb) return;
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) return;
        out.set(imdb, tmdbId);
      });
      return out;
    } catch {
      return new Map();
    }
  })();

  return imdbToTmdbIdPromise;
}

function pickRandom<T>(arr: T[]): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function youtubeEmbedFromTrailer(t?: { site?: string; key?: string; url?: string }): string {
  const site = String(t?.site || "").toLowerCase();
  const key = String(t?.key || "").trim();
  if (site === "youtube" && key) return `https://www.youtube.com/embed/${encodeURIComponent(key)}`;

  const raw = String(t?.url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "").trim();
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
  } catch {
    // ignore
  }
  return "";
}

export default function HomePage() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const [top10, setTop10] = useState<LocalTop10Item[]>([]);
  const [imdbToTmdbId, setImdbToTmdbId] = useState<Map<string, number>>(() => new Map());
  const [plotByImdbId, setPlotByImdbId] = useState<Map<string, string>>(() => new Map());
  const [heroPlaying, setHeroPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, map] = await Promise.all([loadLocalTop10(), loadImdbToTmdbId()]);
      if (!cancelled) {
        setTop10(list);
        setImdbToTmdbId(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!top10.length) return;
      if (!imdbToTmdbId.size) return;

      const candidates = top10
        .map((m) => {
          const imdbId = String(m?.imdbId || "").trim();
          const tmdbId = imdbId ? imdbToTmdbId.get(imdbId) : undefined;
          return {
            imdbId,
            tmdbId: typeof tmdbId === "number" && Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : undefined,
          };
        })
        .filter((x) => x.imdbId && typeof x.tmdbId === "number") as Array<{ imdbId: string; tmdbId: number }>;

      if (!candidates.length) return;

      const results = await Promise.allSettled(
        candidates.map(async ({ imdbId, tmdbId }) => {
          const details = await tmdbGetMovieDetails(tmdbId);
          const overview = String(details?.overview || "").trim();
          return { imdbId, overview };
        })
      );

      if (cancelled) return;
      setPlotByImdbId((prev) => {
        const next = new Map(prev);
        results.forEach((r) => {
          if (r.status !== "fulfilled") return;
          const imdbId = String(r.value.imdbId || "").trim();
          const overview = String(r.value.overview || "").trim();
          if (!imdbId || !overview) return;
          next.set(imdbId, overview);
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [top10, imdbToTmdbId]);

  const featured = useMemo(() => {
    if (!top10.length) return undefined;
    const withTrailers = top10.filter((x) => Array.isArray(x.trailers) && x.trailers!.length > 0);
    return pickRandom(withTrailers.length ? withTrailers : top10);
  }, [top10]);

  const featuredBackdrop = useMemo(() => {
    const urls = featured?.backdropUrls;
    if (!Array.isArray(urls) || !urls.length) return "";
    return String(pickRandom(urls) || "");
  }, [featured]);

  const featuredTrailer = useMemo(() => {
    const item = featured;
    const trailers = (item?.trailers || []).filter((t) => t && (t.key || t.url));
    const preferred = trailers.find((t) => String(t.type || "").toLowerCase() === "trailer") || trailers[0];
    return preferred;
  }, [featured]);

  const featuredTrailerEmbed = useMemo(() => youtubeEmbedFromTrailer(featuredTrailer), [featuredTrailer]);

  useEffect(() => {
    // If featured changes, reset playback state
    setHeroPlaying(false);
  }, [featuredTrailerEmbed, featured?.imdbId]);

  const heroTrailerSrc = useMemo(() => {
    if (!featuredTrailerEmbed) return "";

    const params = new URLSearchParams();
    params.set("autoplay", heroPlaying ? "1" : "0");
    params.set("mute", "1");
    params.set("controls", heroPlaying ? "1" : "0");
    params.set("rel", "0");
    params.set("modestbranding", "1");
    params.set("playsinline", "1");

    return `${featuredTrailerEmbed}?${params.toString()}`;
  }, [featuredTrailerEmbed, heroPlaying]);

  const pageBg = "var(--brand-900)";
  const surfaceMuted = "rgba(255,255,255,0.72)";

  return (
    <>
      <Navbar
        query={query}
        setQuery={setQuery}
        onRecommend={(nextResults, usedQuery) => {
          const q = String(usedQuery || query || "").trim();
          navigate(`/search?q=${encodeURIComponent(q)}`, {
            state: { results: nextResults, q },
          });
        }}
      />

      <div className="pc-home" style={{ backgroundColor: pageBg }}>
        {/* Netflix-like hero */}
        <div
          style={{
            width: "100%",
            minHeight: 640,
            backgroundColor: "var(--brand-900)",
            backgroundImage: !heroTrailerSrc && featuredBackdrop ? `url(${featuredBackdrop})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            position: "relative",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          {/* trailer as background */}
          {heroTrailerSrc ? (
            <iframe
              title={String(featured?.title || "Trailer")}
              src={heroTrailerSrc}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: 0,
                pointerEvents: heroPlaying ? "auto" : "none",
              }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : null}
          {/* Vignette: darken corners and focus center; non-interfering */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 20%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.7) 100%)",
              opacity: heroPlaying ? 0 : 1,
              transition: "opacity 220ms ease",
            }}
          />
          

          {/* overlay gradient */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.30) 60%, rgba(0,0,0,0.12) 100%)",
              pointerEvents: "none",
              opacity: heroPlaying ? 0.25 : 1,
            }}
          />
          <Container style={{ paddingTop: 180, paddingBottom: 56, position: "relative" }}>
            <div style={{ maxWidth: 760, opacity: heroPlaying ? 0 : 1, pointerEvents: heroPlaying ? "none" : "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    letterSpacing: "0.22em",
                    color: surfaceMuted,
                  }}
                >
                  MOVIE
                </div>
              </div>

              <div
                style={{
                  fontSize: 64,
                  fontWeight: 900,
                  color: "var(--text-invert)",
                  letterSpacing: "-0.03em",
                  lineHeight: 0.98,
                  textTransform: "uppercase",
                }}
              >
                {String(featured?.title || "Popular Picks")}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                <div
                    style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 18,
                    padding: "0 6px",
                    borderRadius: 4,
                    background: "var(--brand-900)",
                    color: "var(--text-invert)",
                    fontWeight: 900,
                    fontSize: 11,
                    letterSpacing: "0.06em",
                  }}
                >
                  TOP 10
                </div>
                <div style={{ color: "var(--text-invert)", fontWeight: 800, fontSize: 18 }}>
                  #1 in Movies Today
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  color: "var(--text-invert)",
                  opacity: 0.94,
                  fontSize: 18,
                  lineHeight: 1.6,
                }}
              >
                {featured
                  ? "When you don’t know what to watch next, start here - a curated pick from today’s popular list."
                  : "Loading popular picks…"}
              </div>

              <div style={{ display: "flex", gap: 18, marginTop: 22, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!featuredTrailerEmbed) return;
                    setHeroPlaying(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    height: 50,
                    padding: "0 20px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "var(--text-invert)",
                    color: "var(--brand-900)",
                    fontWeight: 900,
                    cursor: featuredTrailerEmbed ? "pointer" : "default",
                    opacity: featuredTrailerEmbed ? 1 : 0.75,
                  }}
                >
                  Play
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const t = String(featured?.title || "").trim();
                    const q = t || query;
                    if (!q) return;
                    navigate(`/search?q=${encodeURIComponent(q)}`);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    height: 50,
                    padding: "0 20px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.12)",
                    color: "var(--text-invert)",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  More info
                </button>
              </div>
            </div>
          </Container>

          {/* maturity badge (visual only) */}
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: 92,
              padding: "12px 14px",
              borderLeft: "3px solid rgba(255,255,255,0.55)",
              background: "rgba(0,0,0,0.30)",
              color: "var(--text-invert)",
              fontWeight: 900,
              letterSpacing: "0.06em",
              minWidth: 78,
              textAlign: "center",
            }}
          >
            TV-14
          </div>
        </div>

        {/* Popular movies grid */}
        <div className="pc-home-popular">
          <Container style={{ paddingTop: 56, paddingBottom: 120, maxWidth: 1680 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text-invert)", letterSpacing: "-0.02em" }}>
              Popular movies
            </div>
            <div style={{ fontSize: 14, color: surfaceMuted, marginTop: 8, lineHeight: 1.5 }}>
              Top 10 picks
            </div>

            <div className="pc-movie-grid" style={{ marginTop: 18, marginBottom: 0 }}>
              {top10.map((m) => {
                const title = String(m?.title || "").trim();
                const posterUrl = String(m?.posterUrl || "").trim();
                const imdbId = String(m?.imdbId || "").trim();
                const plot = imdbId ? String(plotByImdbId.get(imdbId) || "").trim() : "";

                return (
                  <div
                    key={String(m.imdbId)}
                    className="pc-movie-card"
                    style={{ cursor: title ? "pointer" : "default" }}
                    onClick={() => {
                      const imdb = imdbId;
                      const tmdbId = imdb ? imdbToTmdbId.get(imdb) : undefined;
                      if (typeof tmdbId === "number" && Number.isFinite(tmdbId) && tmdbId > 0) {
                        navigate(`/movie/${tmdbId}`);
                        return;
                      }

                      // Fallback: still let users move forward
                      const q = title;
                      if (!q) return;
                      navigate(`/search?q=${encodeURIComponent(q)}`);
                    }}
                    title={title}
                  >
                    <div className="pc-movie-poster" style={{ background: "var(--surface-muted)" }}>
                      {posterUrl ? (
                        <img src={posterUrl} alt={title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : null}
                    </div>
                    <div className="pc-movie-meta">
                      <div className="pc-movie-title" style={{ color: "var(--text-invert)" }}>
                        {title || "Untitled"}
                      </div>
                      {plot ? (
                        <>
                          <div className="pc-movie-divider" />
                          <div className="pc-movie-overview" style={{ color: "var(--text-invert)" }}>
                            {plot}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Container>
        </div>

        <Footer />
      </div>
    </>
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
        maxWidth: 1520,
        margin: "0 auto",
        padding: "0 32px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
