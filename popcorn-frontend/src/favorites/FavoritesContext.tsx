import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import type { FavoriteMovie } from "./types";
import { apiGetFavorites, apiToggleFavorite } from "./apiFavorites";

type FavoritesContextValue = {
  favorites: FavoriteMovie[];
  isFavorite: (tmdbId: number) => boolean;
  toggleFavorite: (movie: Omit<FavoriteMovie, "addedAt">) => void;
  removeFavorite: (tmdbId: number) => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<FavoriteMovie[]>([]);

  const email = useMemo(() => String(user?.email || "").trim(), [user?.email]);

  useEffect(() => {
    let cancelled = false;
    if (!email) {
      setFavorites([]);
      return;
    }

    (async () => {
      try {
        const items = await apiGetFavorites();
        if (!cancelled) setFavorites(items);
      } catch {
        // not authenticated or backend unavailable
        if (!cancelled) setFavorites([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [email]);

  const isFavorite = useCallback(
    (tmdbId: number) => {
      if (!Number.isFinite(tmdbId) || tmdbId <= 0) return false;
      return favorites.some((f) => f.tmdbId === tmdbId);
    },
    [favorites]
  );

  const removeFavorite = useCallback(
    (tmdbId: number) => {
      if (!email) return;
      if (!Number.isFinite(tmdbId) || tmdbId <= 0) return;
      // backend is toggle-based; if it's currently fav, toggling removes it
      const current = favorites.find((x) => x.tmdbId === tmdbId);
      if (!current) return;
      apiToggleFavorite({ tmdbId, title: current.title, year: current.year, posterUrl: current.posterUrl })
        .then((items) => setFavorites(items))
        .catch(() => {
          // ignore
        });
    },
    [email, favorites]
  );

  const toggleFavorite = useCallback(
    (movie: Omit<FavoriteMovie, "addedAt">) => {
      if (!email) return;
      const tmdbId = Number(movie?.tmdbId);
      if (!Number.isFinite(tmdbId) || tmdbId <= 0) return;

      apiToggleFavorite({
        tmdbId,
        title: String(movie?.title || "").trim() || `Movie ${tmdbId}`,
        year: movie?.year ? String(movie.year) : undefined,
        posterUrl: movie?.posterUrl ? String(movie.posterUrl) : undefined,
      })
        .then((items) => setFavorites(items))
        .catch(() => {
          // ignore
        });
    },
    [email]
  );

  const value = useMemo<FavoritesContextValue>(() => {
    return {
      favorites,
      isFavorite,
      toggleFavorite,
      removeFavorite,
    };
  }, [favorites, isFavorite, toggleFavorite, removeFavorite]);

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider");
  return ctx;
}
