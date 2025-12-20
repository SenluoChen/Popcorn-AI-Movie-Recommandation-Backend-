const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const root = path.resolve(String(process.env.LOCAL_DATA_PATH || ''));
const moviesPath = path.join(root, 'movies', 'movies.ndjson');
const lines = fs.readFileSync(moviesPath, 'utf8').split(/\r?\n/).filter(Boolean);

let total = 0;
let empty = 0;
let nonEmpty = 0;
let missing = 0;

for (const line of lines) {
  total++;
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  if (!('moodTags' in obj)) {
    missing++;
    continue;
  }
  const mt = obj.moodTags;
  if (!Array.isArray(mt) || mt.length === 0) empty++;
  else nonEmpty++;
}

console.log(JSON.stringify({ total, missingMoodTagsField: missing, emptyMoodTags: empty, nonEmptyMoodTags: nonEmpty }, null, 2));
