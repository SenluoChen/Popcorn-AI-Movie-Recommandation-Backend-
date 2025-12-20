const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = process.env.LOCAL_DATA_PATH || path.resolve(__dirname, '..', '..', 'Movie-data');
const moviesPath = path.join(root, 'movies', 'movies.ndjson');
const vectorsPath = path.join(root, 'vectors', 'embeddings.ndjson');
const metaPath = path.join(root, 'index', 'meta.json');
const outPath = path.join(__dirname, '..', 'check_local_data_report.json');

async function scanNdjson(p, callback) {
  if (!fs.existsSync(p)) return 0;
  const stream = fs.createReadStream(p, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let i = 0;
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith('#') || s.startsWith('//')) continue;
    i++;
    let obj = null;
    try { obj = JSON.parse(s); } catch (e) { continue; }
    await callback(obj, i);
  }
  return i;
}

(async () => {
  const report = {
    root,
    movies: { path: moviesPath, count: 0, missingTitle: 0, missingImdb: 0, missingMoodTagsField: 0, emptyMoodTags: 0, moodTagsLenNot5: 0, missingPlot: 0, samples: [] },
    vectors: { path: vectorsPath, count: 0, keys: 0 },
    indexMeta: { path: metaPath, exists: false, count: 0 },
    keyMismatch: { missingVectorForMovie: [], orphanVectors: [] },
  };

  const movieKeys = new Map();

  if (fs.existsSync(moviesPath)) {
    await scanNdjson(moviesPath, async (m, n) => {
      report.movies.count = n;
      const key = (m.imdbId || m.id || m.key || (m.title && m.year ? `${m.title}|${m.year}` : '') ) || '';
      if (key) movieKeys.set(String(key), m);
      if (!m.title) report.movies.missingTitle++;
      if (!m.imdbId) report.movies.missingImdb++;
      if (!('moodTags' in m)) report.movies.missingMoodTagsField++;
      const mt = Array.isArray(m.moodTags) ? m.moodTags : [];
      if (mt.length === 0) report.movies.emptyMoodTags++;
      if (mt.length !== 5) report.movies.moodTagsLenNot5++;
      if (!m.plot && !m.detailedPlot) report.movies.missingPlot++;
      if (report.movies.samples.length < 12) {
        const ok = (m.title || m.imdbId) ? true : false;
        if (!ok || mt.length !== 5 || !m.title || !m.imdbId || !m.plot) {
          report.movies.samples.push({ n, title: m.title || null, imdbId: m.imdbId || null, moodTags: mt, plotPresent: !!(m.plot||m.detailedPlot) });
        }
      }
    });
  }

  const vectorKeys = new Set();
  if (fs.existsSync(vectorsPath)) {
    await scanNdjson(vectorsPath, async (r, n) => {
      report.vectors.count = n;
      const key = String(r.key || r.imdbId || r.id || '').trim();
      if (key) vectorKeys.add(key);
    });
  }

  // compare
  for (const [k, m] of movieKeys) {
    if (!vectorKeys.has(k)) {
      if (report.keyMismatch.missingVectorForMovie.length < 20) report.keyMismatch.missingVectorForMovie.push({ key: k, title: m.title || null, imdbId: m.imdbId || null });
    }
  }
  for (const vk of vectorKeys) {
    if (!movieKeys.has(vk)) {
      if (report.keyMismatch.orphanVectors.length < 20) report.keyMismatch.orphanVectors.push(vk);
    }
  }

  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      report.indexMeta.exists = true;
      report.indexMeta.count = Array.isArray(meta.items) ? meta.items.length : (meta.count || 0);
    } catch (e) { report.indexMeta.exists = false; }
  }

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('[OK] Wrote report ->', outPath);
  console.log(JSON.stringify({ movies: report.movies.count, vectors: report.vectors.count, indexMetaCount: report.indexMeta.count }));
})();
