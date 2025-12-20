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

async function main() {
  const localDataPath = requireEnv('LOCAL_DATA_PATH');
  const moviesPath = path.join(localDataPath, 'movies', 'movies.ndjson');

  if (!fs.existsSync(moviesPath)) {
    console.error(`Not found: ${moviesPath}`);
    process.exitCode = 1;
    return;
  }

  const stream = fs.createReadStream(moviesPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let totalLines = 0;
  let emptyLines = 0;
  let invalidJson = 0;
  let valid = 0;

  let ge75Imdb = 0;
  let ge75Tmdb = 0;

  const keys = new Set();
  let dupKeys = 0;

  for await (const line of rl) {
    totalLines += 1;
    const s = String(line || '').trim();
    if (!s) {
      emptyLines += 1;
      continue;
    }

    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      invalidJson += 1;
      continue;
    }

    valid += 1;

    const key = String(obj?.key || obj?.imdbId || '').trim();
    if (key) {
      if (keys.has(key)) dupKeys += 1;
      keys.add(key);
    }

    const imdb = toNumber(obj?.imdbRating);
    if (Number.isFinite(imdb) && imdb >= 7.5) ge75Imdb += 1;

    const tmdb = toNumber(obj?.tmdbVoteAverage);
    if (Number.isFinite(tmdb) && tmdb >= 7.5) ge75Tmdb += 1;
  }

  console.log(`[Count] file=${moviesPath}`);
  console.log(`[Count] totalLines=${totalLines} emptyLines=${emptyLines}`);
  console.log(`[Count] validJson=${valid} invalidJson=${invalidJson}`);
  console.log(`[Count] uniqueKeys=${keys.size} dupKeys=${dupKeys}`);
  console.log(`[Count] imdbRating>=7.5 = ${ge75Imdb}`);
  console.log(`[Count] tmdbVoteAverage>=7.5 = ${ge75Tmdb}`);
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
