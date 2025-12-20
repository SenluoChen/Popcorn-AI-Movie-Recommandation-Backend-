const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'Movie-data', 'movies', 'movies.ndjson');
const text = fs.readFileSync(filePath, 'utf8');
const lines = text.split(/\r?\n/).filter(Boolean);

const summary = {};
let total = 0;
for (const line of lines) {
  total++;
  let o;
  try { o = JSON.parse(line); } catch { continue; }
  const id = String(o.imdbId || o.key || o.tmdbId || `#${total}`);
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v) && v.length === 0) {
      if (!summary[k]) summary[k] = { count: 0, examples: [] };
      summary[k].count++;
      if (summary[k].examples.length < 10) summary[k].examples.push({ id, title: o.title });
    }
  }
}

console.log(JSON.stringify({ total, fields: summary }, null, 2));
