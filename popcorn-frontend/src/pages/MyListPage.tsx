import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import Footer from "../components/footer";
import { useAuth } from "../auth/AuthContext";
import { useFavorites } from "../favorites/FavoritesContext";

import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";

import "../App.css";

export default function MyListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();

  const [query, setQuery] = useState("");

  const pageBg = "var(--brand-900)";
  const muted = "var(--surface-muted)";

  const title = useMemo(() => {
    const name = String(user?.email || "").split("@")[0];
    if (!user) return "My List";
    return name ? `${name}'s List` : "My List";
  }, [user]);

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

      <div style={{ backgroundColor: pageBg, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1 }}>
          <Container style={{ paddingTop: 56, paddingBottom: 64, maxWidth: 1680 }}>
            <div className="pc-section-header">
              <div className="pc-section-title">{title}</div>
              <div className="pc-section-sub">Saved favourite movies</div>
            </div>

            {!user ? (
              <div style={{ color: muted, lineHeight: 1.7, marginTop: 18 }}>
                Please <Link to="/" style={{ textDecoration: "underline" }}>log in</Link> to use My List.
              </div>
            ) : favorites.length === 0 ? (
              <div style={{ color: muted, lineHeight: 1.7, marginTop: 18 }}>
                No saved movies yet. Tap the heart on any movie card to add it here.
              </div>
            ) : (
              <div className="pc-movie-grid" style={{ marginTop: 18 }}>
                {favorites.map((m) => {
                  const year = String(m.year || "").trim();
                  const posterUrl = String(m.posterUrl || "").trim();
                  const fav = isFavorite(m.tmdbId);

                  return (
                    <div
                      key={String(m.tmdbId)}
                      className="pc-movie-card"
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate(`/movie/${m.tmdbId}`)}
                      title={m.title}
                    >
                      <button
                        type="button"
                        className={`pc-fav-btn${fav ? " is-active" : ""}`}
                        aria-label={fav ? "Remove from My List" : "Add to My List"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite({
                            tmdbId: m.tmdbId,
                            title: m.title,
                            year,
                            posterUrl,
                          });
                        }}
                      >
                        {fav ? <FavoriteRoundedIcon /> : <FavoriteBorderRoundedIcon />}
                      </button>

                      <div className="pc-movie-poster" style={{ background: "var(--surface-muted)" }}>
                        {posterUrl ? (
                          <img
                            src={posterUrl}
                            alt={m.title}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : null}
                      </div>
                      <div className="pc-movie-meta">
                        <div className="pc-movie-title" style={{ color: "var(--text-invert)" }}>
                          {m.title}{year ? ` (${year})` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Container>
        </div>

        <Footer />
      </div>
    </>
  );
}

function Container({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
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
