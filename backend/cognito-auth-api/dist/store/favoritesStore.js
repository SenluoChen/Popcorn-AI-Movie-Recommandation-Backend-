import fs from "fs/promises";
import path from "path";
const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "favorites.json");
let lock = Promise.resolve();
async function withLock(fn) {
    const prev = lock;
    let release;
    lock = new Promise((r) => (release = r));
    await prev;
    try {
        return await fn();
    }
    finally {
        if (release)
            release();
    }
}
async function ensureDir() {
    await fs.mkdir(DATA_DIR, { recursive: true });
}
async function readDb() {
    await ensureDir();
    try {
        const raw = await fs.readFile(DB_PATH, "utf8");
        const data = JSON.parse(raw);
        const users = data && typeof data === "object" && data.users && typeof data.users === "object" ? data.users : {};
        const cleanUsers = {};
        for (const [email, list] of Object.entries(users)) {
            const arr = Array.isArray(list) ? list : [];
            cleanUsers[email] = arr
                .map((x) => ({
                tmdbId: Number(x?.tmdbId),
                title: String(x?.title || "").trim(),
                year: x?.year ? String(x.year) : undefined,
                posterUrl: x?.posterUrl ? String(x.posterUrl) : undefined,
                addedAt: Number(x?.addedAt),
            }))
                .filter((m) => Number.isFinite(m.tmdbId) && m.tmdbId > 0 && m.title)
                .map((m) => ({ ...m, addedAt: Number.isFinite(m.addedAt) ? m.addedAt : Date.now() }))
                .sort((a, b) => b.addedAt - a.addedAt);
        }
        return { users: cleanUsers };
    }
    catch {
        return { users: {} };
    }
}
async function writeDb(db) {
    await ensureDir();
    const tmp = `${DB_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await fs.rename(tmp, DB_PATH);
}
export async function getFavoritesForUser(email) {
    return withLock(async () => {
        const db = await readDb();
        return Array.isArray(db.users[email]) ? db.users[email] : [];
    });
}
export async function toggleFavoriteForUser(email, movie) {
    return withLock(async () => {
        const db = await readDb();
        const list = Array.isArray(db.users[email]) ? db.users[email] : [];
        const tmdbId = Number(movie.tmdbId);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0)
            throw new Error("tmdbId is required");
        const idx = list.findIndex((x) => x.tmdbId === tmdbId);
        if (idx >= 0) {
            const next = [...list.slice(0, idx), ...list.slice(idx + 1)];
            db.users[email] = next;
            await writeDb(db);
            return next;
        }
        const next = [
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
