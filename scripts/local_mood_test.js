const fs = require('fs');
const path = require('path');

function findRepoRoot() {
  const seeds = [__dirname, process.cwd()];
  for (const seed of seeds) {
    let cur = seed;
    for (let i = 0; i < 8; i++) {
      const tryMovie = path.join(cur, 'Movie-data');
      const tryPopcorn = path.join(cur, 'Popcorn');
      if (fs.existsSync(tryMovie) && fs.existsSync(tryPopcorn)) return cur;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return process.cwd();
}

const repoRoot = findRepoRoot();
console.log('repoRoot:', repoRoot);
const idxPath = path.join(repoRoot, 'Popcorn', 'infra', 'movies-ddb-cdk', 'lambda', 'search', 'index.js');
console.log('idxPath:', idxPath);
if (!fs.existsSync(idxPath)) {
  console.error('Cannot find index.js at', idxPath);
  process.exit(2);
}
const idx = require(idxPath);
const helpers = idx._test;

function readNdjson(filePath) {
  const s = fs.readFileSync(filePath, 'utf8');
  return s.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(Boolean);
}

function normalizeFreeTextLocal(text) {
  return String(text || '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function wordsSet(text) {
  return new Set((normalizeFreeTextLocal(text) || '').split(/[^a-z0-9\u4e00-\u9fff\-]+/).filter(Boolean));
}

function jaccard(aSet, bSet) {
  const a = Array.from(aSet);
  const b = Array.from(bSet);
  if (!a.length || !b.length) return 0;
  let inter = 0;
  for (const x of a) if (bSet.has(x)) inter++;
  const uni = new Set([...a, ...b]).size;
  return inter / uni;
}

function toMoodTagsLocal(value) {
  if (Array.isArray(value)) return value.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/[\s,;|]+/g)
    .map((t) => String(t || '').trim().toLowerCase())
    .filter(Boolean);
}

const moviesPath = path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson');
console.log('moviesPath:', moviesPath);
const movies = readNdjson(moviesPath);
console.log('Loaded movies:', movies.length);

const queries = [
  '激勵人心電影',
  'uplifting movies',
  '感人 勵志 電影',
  'inspirational movies for families',
  '鼓舞人心的故事電影'
];

for (const q of queries) {
  const hints = helpers.buildQueryHints(q);

  const scored = movies.map((m) => {
    const movieText = helpers.buildMovieSearchText(m);
    const sim = jaccard(wordsSet(q), wordsSet(movieText));

    let lexicalBoost = 0;
    for (const term of hints.lexicalTerms || []) {
      if (term && movieText.includes(String(term).toLowerCase())) lexicalBoost += 0.02;
    }
    lexicalBoost = Math.min(0.12, lexicalBoost);

    // mood boost
    let moodBoost = 0;
    const wantMood = Array.isArray(hints?.moodWantTags) ? hints.moodWantTags : [];
    if (wantMood.length) {
      const mt = new Set(toMoodTagsLocal(m?.moodTags));
      let matched = 0;
      for (const t of wantMood) if (t && mt.has(String(t).toLowerCase())) matched++;
      moodBoost = Math.min(0.12, matched * 0.03);
    }

    const { boost: genreBoost, penalty: genrePenalty } = (idx && idx._test && idx._test) ? { boost: 0, penalty: 0 } : { boost: 0, penalty: 0 };

    const score = sim + lexicalBoost + moodBoost + genreBoost + genrePenalty;
    return { imdbId: m.imdbId, title: m.title, year: m.year, moodTags: m.moodTags, sim, lexicalBoost, moodBoost, score, movieText };
  }).filter(Boolean);

  // before: remove mood hints
  const scoredBefore = scored.map((s) => ({ ...s, score: s.score - s.moodBoost, moodBoost: 0 }));

  scoredBefore.sort((a,b) => b.score - a.score);
  scored.sort((a,b) => b.score - a.score);

  console.log('\nQuery:', q);
  console.log('Hints:', JSON.stringify(hints));
  console.log('\nTop 5 before (no moodBoost):');
  scoredBefore.slice(0,5).forEach((r,i)=>{
    console.log(`${i+1}. ${r.title} (${r.year}) - score=${r.score.toFixed(4)} moodTags=${JSON.stringify(r.moodTags)}`);
  });

  console.log('\nTop 5 after (with moodBoost):');
  scored.slice(0,5).forEach((r,i)=>{
    console.log(`${i+1}. ${r.title} (${r.year}) - score=${r.score.toFixed(4)} moodBoost=${r.moodBoost.toFixed(3)} moodTags=${JSON.stringify(r.moodTags)}`);
  });
}

console.log('\nDone');
