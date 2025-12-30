import fs from "fs/promises";
import path from "path";

export type FavoriteMovie = {
  tmdbId: number;
  title: string;
  year?: string;
  posterUrl?: string;
  addedAt: number;
};

export type FavoriteMovieInput = {
  tmdbId: number;
  title: string;
  year?: string;
  posterUrl?: string;
};

type DbShape = {
  users: Record<string, FavoriteMovie[]>;
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "favorites.json");

let lock: Promise<void> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lock;
  let release: (() => void) | undefined;
  lock = new Promise<void>((r) => (release = r));
  await prev;
  try {
    return await fn();
  } finally {
    if (release) release();
  }
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readDb(): Promise<DbShape> {
  await ensureDir();
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const data = JSON.parse(raw);
    const users = data && typeof data === "object" && data.users && typeof data.users === "object" ? data.users : {};

    const cleanUsers: Record<string, FavoriteMovie[]> = {};
    for (const [email, list] of Object.entries(users)) {
      const arr: any[] = Array.isArray(list) ? list : [];
      cleanUsers[email] = arr
        .map((x) => ({
          tmdbId: Number((x as any)?.tmdbId),
          title: String((x as any)?.title || "").trim(),
          year: (x as any)?.year ? String((x as any).year) : undefined,
          posterUrl: (x as any)?.posterUrl ? String((x as any).posterUrl) : undefined,
          addedAt: Number((x as any)?.addedAt),
        }))
        .filter((m) => Number.isFinite(m.tmdbId) && m.tmdbId > 0 && m.title)
        .map((m) => ({ ...m, addedAt: Number.isFinite(m.addedAt) ? m.addedAt : Date.now() }))
        .sort((a, b) => b.addedAt - a.addedAt);
    }

    return { users: cleanUsers };
  } catch {
    return { users: {} };
  }
}

async function writeDb(db: DbShape) {
  await ensureDir();
  const tmp = `${DB_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DB_PATH);
}

export async function getFavoritesForUser(email: string): Promise<FavoriteMovie[]> {
  return withLock(async () => {
    const db = await readDb();
    return Array.isArray(db.users[email]) ? db.users[email] : [];
  });
}

export async function toggleFavoriteForUser(email: string, movie: FavoriteMovieInput): Promise<FavoriteMovie[]> {
  return withLock(async () => {
    const db = await readDb();
    const list = Array.isArray(db.users[email]) ? db.users[email] : [];

    const tmdbId = Number(movie.tmdbId);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) throw new Error("tmdbId is required");

    const idx = list.findIndex((x) => x.tmdbId === tmdbId);
    if (idx >= 0) {
      const next = [...list.slice(0, idx), ...list.slice(idx + 1)];
      db.users[email] = next;
      await writeDb(db);
      return next;
    }

    const next: FavoriteMovie[] = [
      {
        tmdbId,
        title: String(movie.title || "").trim() || `Movie ${tmdbId}`,
        year: movie.year ? String(movie.year) : undefined,
        posterUrl: movie.posterUrl ? String(movie.posterUrl) : undefined,
        addedAt: Date.now(),
      },
      ...list,
    ];

    db.users[email] = next;
    await writeDb(db);
    return next;
  });
}
