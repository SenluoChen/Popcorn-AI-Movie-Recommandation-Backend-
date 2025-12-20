const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const moviesPath = path.join(repoRoot, 'Movie-data', 'movies', 'movies.ndjson');
const indexPath = path.join(repoRoot, 'Movie-data', 'index', 'meta.json');

function main() {
  if (!fs.existsSync(moviesPath)) {
    console.error('movies.ndjson not found:', moviesPath);
    process.exit(2);
  }
  if (!fs.existsSync(indexPath)) {
    console.error('index meta.json not found:', indexPath);
    process.exit(2);
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const map = new Map();
  for (const item of index.items || []) {
    if (item.key) map.set(item.key, item.moodTags || []);
    if (item.imdbId) map.set(item.imdbId, item.moodTags || []);
  }

  const inText = fs.readFileSync(moviesPath, 'utf8');
  const lines = inText.split(/\r?\n/).filter(Boolean);

  const out = [];
  let total = 0;
  let updated = 0;

  for (const line of lines) {
    total++;
    let o;
    try { o = JSON.parse(line); } catch (e) { out.push(line); continue; }

    const key = o.key || o.imdbId || '';
    const indexTags = map.get(key);
    const hasTags = Array.isArray(o.moodTags) && o.moodTags.length > 0;

    if (!hasTags && Array.isArray(indexTags) && indexTags.length > 0) {
      o.moodTags = indexTags;
      updated++;
    }
    out.push(JSON.stringify(o));
  }

  // backup
  const backup = moviesPath + '.bak2';
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, inText, 'utf8');
  fs.writeFileSync(moviesPath, out.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({moviesPath, indexPath, total, updated}, null, 2));
}

main();
