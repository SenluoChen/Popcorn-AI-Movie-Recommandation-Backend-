require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const readline = require('node:readline');

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value);
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function getScore(movie) {
  const imdb = toNumber(movie?.imdbRating);
  const tmdb = toNumber(movie?.tmdbVoteAverage);
  const score = Number.isFinite(imdb) ? imdb : (Number.isFinite(tmdb) ? tmdb : 0);
  const votes = toNumber(movie?.tmdbVoteCount);
  return {
    score,
    votes: Number.isFinite(votes) ? votes : 0,
  };
}

async function main() {
  const args = process.argv.slice(2);

  const localDataPath = requireEnv('LOCAL_DATA_PATH');
  const moviesPath = path.join(localDataPath, 'movies', 'movies.ndjson');

  const outJsonPath = (() => {
    const idx = args.indexOf('--out');
    if (idx >= 0 && args[idx + 1]) return path.resolve(args[idx + 1]);
    return path.join(localDataPath, 'movies', 'top500.json');
  })();

  const outNdjsonPath = (() => {
    const idx = args.indexOf('--out-ndjson');
    if (idx >= 0 && args[idx + 1]) return path.resolve(args[idx + 1]);
    return path.join(localDataPath, 'movies', 'top500.ndjson');
  })();

  const minRating = (() => {
    const idx = args.indexOf('--min-rating');
    if (idx >= 0 && args[idx + 1]) {
      const n = Number(args[idx + 1]);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  })();

  const limit = (() => {
    const idx = args.indexOf('--limit');
    if (idx >= 0 && args[idx + 1]) {
      const n = Number(args[idx + 1]);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
    }
    return 500;
  })();

  if (!fs.existsSync(moviesPath)) {
    console.error(`Not found: ${moviesPath}`);
    process.exitCode = 1;
    return;
  }

  const stream = fs.createReadStream(moviesPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const byKey = new Map();
  let invalidJson = 0;

  for await (const line of rl) {
    const s = String(line || '').trim();
    if (!s) continue;

    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      invalidJson += 1;
      continue;
    }

    const key = String(obj?.key || obj?.imdbId || '').trim();
    if (!key) continue;

    // Keep the first occurrence to avoid duplicates.
    if (!byKey.has(key)) byKey.set(key, obj);
  }

  const movies = [...byKey.values()];

  const filtered = movies.filter(m => {
    const { score } = getScore(m);
    return score >= minRating;
  });

  filtered.sort((a, b) => {
    const sa = getScore(a);
    const sb = getScore(b);
    if (sb.score !== sa.score) return sb.score - sa.score;
    if (sb.votes !== sa.votes) return sb.votes - sa.votes;
    const ya = String(a?.year || '');
    const yb = String(b?.year || '');
    return yb.localeCompare(ya);
  });

  const top = filtered.slice(0, limit);

  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify(top, null, 2), 'utf8');

  const ndjson = top.map(x => JSON.stringify(x)).join('\n') + (top.length ? '\n' : '');
  fs.writeFileSync(outNdjsonPath, ndjson, 'utf8');

  console.log(`[Export] readUnique=${movies.length} invalidJson=${invalidJson}`);
  console.log(`[Export] filtered(score>=${minRating})=${filtered.length}`);
  console.log(`[Export] wrote top=${top.length}`);
  console.log(`[Export] json=${outJsonPath}`);
  console.log(`[Export] ndjson=${outNdjsonPath}`);
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
